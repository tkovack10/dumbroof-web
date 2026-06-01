import JSZip from "jszip";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Claim } from "@/types/claim";
import { CATEGORY_CONFIG, type UploadCategory } from "@/lib/claim-constants";

export type UploadStatus = "idle" | "uploading" | "success" | "error";

export function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/_{2,}/g, "_");
}

/**
 * Upload directly to a Supabase Storage signed URL via fetch.
 * Bypasses the Supabase SDK entirely to avoid Navigator.locks auth contention
 * that causes "LockManager lock timed out" errors on mobile.
 * Includes retry logic for transient network failures.
 */
export async function directUpload(
  signedUrl: string,
  file: File,
  maxRetries = 2
): Promise<void> {
  const body = new FormData();
  body.append("cacheControl", "3600");
  body.append("", file); // empty key matches Supabase SDK convention

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(signedUrl, {
        method: "PUT",
        headers: { "x-upsert": "true" },
        body,
      });

      if (response.ok) return;

      const text = await response.text().catch(() => "");
      if (text.includes("already exists") || text.includes("Duplicate")) return;

      if (response.status >= 500 && attempt < maxRetries) {
        lastError = new Error(`Server error ${response.status}: ${text}`);
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }

      throw new Error(`Upload failed (${response.status}): ${text}`);
    } catch (err) {
      if (err instanceof TypeError && attempt < maxRetries) {
        // TypeError: "Load failed" — transient network error on mobile
        lastError = err;
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      if (err instanceof Error) throw err;
      throw new Error(String(err));
    }
  }

  throw lastError || new Error("Upload failed after retries");
}

/**
 * Upload a single file via signed URL.
 * Uses direct fetch to bypass Supabase SDK Navigator.locks.
 * `signEndpoint` defaults to the user endpoint; admin pages pass `/api/admin/sign-upload`.
 */
export async function uploadSingleFile(
  _supabase: SupabaseClient,
  file: File,
  folder: string,
  claimPath: string,
  signEndpoint = "/api/storage/sign-upload"
): Promise<string> {
  const res = await fetch(signEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folder, fileName: file.name, claimPath }),
  });
  const urlData = await res.json();
  if (!res.ok) throw new Error(`Failed to upload ${file.name}: ${urlData.error}`);

  await directUpload(urlData.signedUrl, file);
  return urlData.safeName;
}

const IMAGE_EXTS = ["jpg", "jpeg", "png", "heic", "heif", "webp", "tiff", "tif", "bmp"];

/**
 * Extract images from a ZIP and upload each one. Returns array of uploaded filenames.
 */
export async function extractAndUploadZip(
  supabase: SupabaseClient,
  zipFile: File,
  folder: string,
  claimPath: string,
  signEndpoint = "/api/storage/sign-upload"
): Promise<string[]> {
  const zip = await JSZip.loadAsync(zipFile);
  const uploadedNames: string[] = [];

  const entries = Object.entries(zip.files).filter(([path, entry]) => {
    if (entry.dir) return false;
    if (path.includes("__MACOSX") || path.startsWith(".")) return false;
    const ext = path.split(".").pop()?.toLowerCase();
    return ext && IMAGE_EXTS.includes(ext);
  });

  // Upload with concurrency limit of 5
  const CONCURRENCY = 5;
  for (let i = 0; i < entries.length; i += CONCURRENCY) {
    const batch = entries.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async ([path, entry]) => {
        const blob = await entry.async("blob");
        if (blob.size < 10240) return null; // Skip thumbnails < 10KB
        const ext = path.split(".").pop()?.toLowerCase() || "jpg";
        const name = path.split("/").pop() || path;
        const photo = new File([blob], name, { type: `image/${ext === "jpg" ? "jpeg" : ext}` });
        return uploadSingleFile(supabase, photo, folder, claimPath, signEndpoint);
      })
    );
    uploadedNames.push(...results.filter((n): n is string => n !== null));
  }

  return uploadedNames;
}

/**
 * Upload files for a claim category. Handles ZIP extraction for photos.
 * Returns array of uploaded filenames.
 */
export async function uploadClaimDocuments(
  supabase: SupabaseClient,
  files: File[],
  category: UploadCategory,
  claim: Claim,
  signEndpoint = "/api/storage/sign-upload"
): Promise<string[]> {
  const catConfig = CATEGORY_CONFIG[category];
  const folder = catConfig.folder;
  const uploadedNames: string[] = [];

  for (const file of files) {
    if (folder === "photos" && file.name.toLowerCase().endsWith(".zip")) {
      const zipNames = await extractAndUploadZip(supabase, file, "photos", claim.file_path, signEndpoint);
      uploadedNames.push(...zipNames);
    } else {
      const name = await uploadSingleFile(supabase, file, folder, claim.file_path, signEndpoint);
      uploadedNames.push(name);
    }
  }

  return uploadedNames;
}

/**
 * Upload multiple files with concurrent batching.
 * Handles ZIP extraction for photos. Individual failures don't abort the batch.
 * Returns { uploaded: string[], errors: string[] }.
 */
export async function uploadFilesBatched(
  supabase: SupabaseClient,
  files: File[],
  folder: string,
  claimPath: string,
  options?: {
    concurrency?: number;
    signEndpoint?: string;
    onProgress?: (completed: number, total: number) => void;
  }
): Promise<{ uploaded: string[]; errors: string[] }> {
  const concurrency = options?.concurrency ?? 3;
  const signEndpoint = options?.signEndpoint ?? "/api/storage/sign-upload";
  const uploaded: string[] = [];
  const errors: string[] = [];

  // Flatten: expand ZIPs into individual photo files
  const tasks: File[] = [];

  for (const file of files) {
    if (folder === "photos" && file.name.toLowerCase().endsWith(".zip")) {
      const zip = await JSZip.loadAsync(file);
      for (const [path, entry] of Object.entries(zip.files)) {
        if (entry.dir) continue;
        if (path.includes("__MACOSX") || path.startsWith(".")) continue;
        const ext = path.split(".").pop()?.toLowerCase();
        if (!ext || !IMAGE_EXTS.includes(ext)) continue;
        const blob = await entry.async("blob");
        if (blob.size < 10240) continue;
        const name = path.split("/").pop() || path;
        tasks.push(new File([blob], name, { type: `image/${ext === "jpg" ? "jpeg" : ext}` }));
      }
    } else {
      tasks.push(file);
    }
  }

  const total = tasks.length;
  let completed = 0;

  for (let i = 0; i < tasks.length; i += concurrency) {
    const batch = tasks.slice(i, i + concurrency);
    const results = await Promise.allSettled(
      batch.map((file) =>
        uploadSingleFile(supabase, file, folder, claimPath, signEndpoint)
      )
    );

    for (let j = 0; j < results.length; j++) {
      const result = results[j];
      if (result.status === "fulfilled") {
        uploaded.push(result.value);
      } else {
        errors.push(`${batch[j].name}: ${result.reason?.message || "Unknown error"}`);
      }
    }

    completed += batch.length;
    options?.onProgress?.(Math.min(completed, total), total);
  }

  return { uploaded, errors };
}

// Decode an image File (incl. HEIC on Safari, which can render it) to JPEG bytes
// via canvas, capping the long edge so a 12MP phone photo becomes a reasonably
// sized, still-legible document page.
async function imageToJpegBytes(
  file: File
): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error("image decode failed"));
      im.src = url;
    });
    const MAX = 2600;
    let w = img.naturalWidth || img.width;
    let h = img.naturalHeight || img.height;
    if (!w || !h) throw new Error("zero-size image");
    if (Math.max(w, h) > MAX) {
      const s = MAX / Math.max(w, h);
      w = Math.round(w * s);
      h = Math.round(h * s);
    }
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d canvas context");
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((res) =>
      canvas.toBlob(res, "image/jpeg", 0.92)
    );
    if (!blob) throw new Error("jpeg encode failed");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return { bytes, width: w, height: h };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * "Users should never have to convert for DumbRoof." Turn a photo of a document
 * (e.g. a signed AOB snapped on a phone) into a real single-page PDF in the
 * browser, so it flows through the same `.pdf` path the rest of the pipeline —
 * and the carrier email attachment — expects, and the carrier can actually open
 * it. Already-PDF files pass through untouched; a non-image / non-pdf file
 * (e.g. .docx) passes through too. If the browser can't decode the image
 * (e.g. HEIC on a non-Safari browser), we return the ORIGINAL file rather than
 * block the user — the caller should name the upload from the returned file's
 * real type so it's never a mislabeled `.pdf`.
 */
export async function ensurePdfFile(file: File): Promise<File> {
  const looksPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  if (looksPdf) return file;
  const looksImage =
    file.type.startsWith("image/") ||
    /\.(jpe?g|png|heic|heif|webp|tiff?|bmp|gif)$/i.test(file.name);
  if (!looksImage) return file;

  try {
    const { bytes, width, height } = await imageToJpegBytes(file);
    const { PDFDocument } = await import("pdf-lib");
    const pdf = await PDFDocument.create();
    const jpg = await pdf.embedJpg(bytes);
    const page = pdf.addPage([width, height]);
    page.drawImage(jpg, { x: 0, y: 0, width, height });
    const pdfBytes = await pdf.save();
    const base = file.name.replace(/\.[^.]+$/, "").trim() || "document";
    // Copy into a fresh ArrayBuffer-backed view so it's a valid BlobPart
    // (TS 5.7 no longer accepts a Uint8Array<ArrayBufferLike> directly).
    return new File([new Uint8Array(pdfBytes)], `${base}.pdf`, { type: "application/pdf" });
  } catch {
    return file; // never block the user
  }
}

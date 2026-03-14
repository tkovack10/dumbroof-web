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

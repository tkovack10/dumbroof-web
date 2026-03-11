import JSZip from "jszip";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Claim } from "@/types/claim";
import { CATEGORY_CONFIG, type UploadCategory } from "@/lib/claim-constants";

export function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/_{2,}/g, "_");
}

/**
 * Upload a single file via signed URL.
 * `signEndpoint` defaults to the user endpoint; admin pages pass `/api/admin/sign-upload`.
 */
export async function uploadSingleFile(
  supabase: SupabaseClient,
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

  const { error } = await supabase.storage
    .from("claim-documents")
    .uploadToSignedUrl(urlData.path, urlData.token, file);
  if (error && !error.message.includes("already exists") && !error.message.includes("Duplicate")) {
    throw new Error(`Failed to upload ${file.name}: ${error.message}`);
  }
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

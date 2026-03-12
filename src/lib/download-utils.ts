import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Download a single file from Supabase storage and trigger browser download.
 */
export async function downloadFile(
  supabase: SupabaseClient,
  filePath: string,
  outputDir: string,
  filename: string,
): Promise<void> {
  const path = `${filePath}/output/${filename}`;
  const { data, error } = await supabase.storage
    .from("claim-documents")
    .download(path);
  if (error) throw error;
  const url = URL.createObjectURL(data);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Download all files sequentially with a small delay between each.
 */
export async function downloadAllFiles(
  supabase: SupabaseClient,
  filePath: string,
  files: string[],
): Promise<void> {
  for (const file of files) {
    await downloadFile(supabase, filePath, "", file);
    await new Promise((r) => setTimeout(r, 500));
  }
}

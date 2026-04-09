/**
 * Client-side image compression using Canvas API.
 * Resizes large images (especially HEIC from iPhones) and converts to JPEG
 * before upload. Reduces 10-15MB HEIC files to ~300-500KB JPEGs.
 *
 * No external dependencies — pure browser APIs.
 */

const DEFAULT_MAX_DIMENSION = 2048;
const DEFAULT_QUALITY = 0.82;
const SKIP_IF_UNDER_BYTES = 500_000; // 500KB — already small enough

/**
 * Compress an image file by resizing and converting to JPEG.
 * Skips non-image files (PDFs, ZIPs) and already-small images.
 */
export async function compressImage(
  file: File,
  maxDimension = DEFAULT_MAX_DIMENSION,
  quality = DEFAULT_QUALITY
): Promise<File> {
  // Skip non-image files
  if (!file.type.startsWith("image/") && !file.name.match(/\.(heic|heif)$/i)) {
    return file;
  }

  // Skip if already small enough
  if (file.size < SKIP_IF_UNDER_BYTES) {
    return file;
  }

  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);

      let { width, height } = img;

      // Scale down if either dimension exceeds max
      if (width > maxDimension || height > maxDimension) {
        const ratio = Math.min(maxDimension / width, maxDimension / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(file); // fallback — return original
        return;
      }

      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        (blob) => {
          // Free canvas pixel buffer immediately (don't wait for GC)
          canvas.width = 0;
          canvas.height = 0;

          if (!blob || blob.size >= file.size) {
            resolve(file);
            return;
          }
          const name = file.name.replace(/\.(heic|heif|png|bmp|tiff?)$/i, ".jpg");
          resolve(new File([blob], name, { type: "image/jpeg", lastModified: Date.now() }));
        },
        "image/jpeg",
        quality
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(file); // fallback — return original on decode failure (e.g. HEIC on some browsers)
    };

    img.src = url;
  });
}

/**
 * Compress multiple image files with bounded concurrency.
 * Limits to 4 simultaneous canvas operations to avoid OOM on mobile.
 */
export async function compressImages(
  files: File[],
  maxDimension = DEFAULT_MAX_DIMENSION,
  quality = DEFAULT_QUALITY
): Promise<File[]> {
  const CONCURRENCY = 4;
  const results: File[] = new Array(files.length);
  let cursor = 0;

  async function worker() {
    while (cursor < files.length) {
      const idx = cursor++;
      results[idx] = await compressImage(files[idx], maxDimension, quality);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, files.length) }, () => worker())
  );
  return results;
}

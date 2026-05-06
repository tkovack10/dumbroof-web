/**
 * Client-side image compression using Canvas API.
 * Resizes large images (especially HEIC from iPhones) and converts to JPEG
 * before upload. Reduces 10-15MB HEIC files to ~300-500KB JPEGs.
 *
 * EXIF preservation: canvas re-encode strips ALL EXIF (GPS, timestamp,
 * heading). We read the EXIF BEFORE compression with exifr and emit a
 * sidecar `<filename>.exif.json` File alongside each compressed photo.
 * The backend processor merges these sidecars into the photos table —
 * see backend/processor.py "Sidecar fallback" block.
 */
import exifr from "exifr";

const DEFAULT_MAX_DIMENSION = 2048;
const DEFAULT_QUALITY = 0.82;
const SKIP_IF_UNDER_BYTES = 500_000; // 500KB — already small enough

export type ExifSidecar = {
  gps_lat?: number;
  gps_lon?: number;
  exif_timestamp?: string; // ISO 8601
  heading?: number;
  altitude?: number;
  focal_length_mm?: number;
  software?: string;
  make?: string;
  model?: string;
};

export type CompressedPhoto = {
  file: File;
  sidecar: File | null; // <filename>.exif.json — null when no extractable EXIF
};

/**
 * Pull location/orientation/timestamp metadata from a File using exifr.
 * Returns null when no useful fields are extractable. Robust against
 * exifr throwing on malformed/partial EXIF — never crashes the upload.
 */
async function readExifMetadata(file: File): Promise<ExifSidecar | null> {
  try {
    const parsed = await exifr.parse(file, {
      gps: true,
      pick: [
        "GPSLatitude",
        "GPSLongitude",
        "GPSImgDirection",
        "GPSAltitude",
        "GPSAltitudeRef",
        "DateTimeOriginal",
        "DateTimeDigitized",
        "DateTime",
        "Software",
        "Make",
        "Model",
        "FocalLengthIn35mmFormat",
        "FocalLength",
        "latitude",
        "longitude",
      ],
    });
    if (!parsed) return null;
    const out: ExifSidecar = {};
    // exifr normalizes GPS to decimal `latitude`/`longitude` already
    if (typeof parsed.latitude === "number") out.gps_lat = parsed.latitude;
    if (typeof parsed.longitude === "number") out.gps_lon = parsed.longitude;
    if (typeof parsed.GPSImgDirection === "number" && parsed.GPSImgDirection >= 0 && parsed.GPSImgDirection <= 360) {
      out.heading = parsed.GPSImgDirection;
    }
    if (typeof parsed.GPSAltitude === "number") {
      const alt = parsed.GPSAltitude;
      out.altitude = parsed.GPSAltitudeRef === 1 ? -alt : alt;
    }
    const dt = parsed.DateTimeOriginal || parsed.DateTimeDigitized || parsed.DateTime;
    if (dt) {
      const iso = dt instanceof Date ? dt.toISOString() : new Date(String(dt)).toISOString();
      if (iso && !iso.startsWith("Invalid")) out.exif_timestamp = iso;
    }
    if (parsed.Software) out.software = String(parsed.Software).slice(0, 200);
    if (parsed.Make) out.make = String(parsed.Make).slice(0, 64);
    if (parsed.Model) out.model = String(parsed.Model).slice(0, 64);
    if (typeof parsed.FocalLengthIn35mmFormat === "number") {
      out.focal_length_mm = parsed.FocalLengthIn35mmFormat;
    } else if (typeof parsed.FocalLength === "number") {
      out.focal_length_mm = parsed.FocalLength;
    }
    return Object.keys(out).length > 0 ? out : null;
  } catch (e) {
    console.warn("[image-compress] EXIF read failed (non-fatal):", e);
    return null;
  }
}

/**
 * Build a sidecar JSON File whose name matches the compressed photo's
 * basename + `.exif.json`. The backend looks for this exact pattern
 * during processing.
 */
function buildSidecarFile(photoName: string, meta: ExifSidecar): File {
  const dot = photoName.lastIndexOf(".");
  const stem = dot > 0 ? photoName.slice(0, dot) : photoName;
  const sidecarName = `${stem}.exif.json`;
  const json = JSON.stringify(meta);
  return new File([json], sidecarName, { type: "application/json", lastModified: Date.now() });
}

/**
 * Compress an image file by resizing and converting to JPEG.
 * Skips non-image files (PDFs, ZIPs) and already-small images.
 * Returns the compressed file PLUS an optional sidecar carrying EXIF.
 */
export async function compressImage(
  file: File,
  maxDimension = DEFAULT_MAX_DIMENSION,
  quality = DEFAULT_QUALITY
): Promise<CompressedPhoto> {
  // Skip non-image files
  if (!file.type.startsWith("image/") && !file.name.match(/\.(heic|heif)$/i)) {
    return { file, sidecar: null };
  }

  // Read EXIF FIRST, while the bytes are still intact. This is the only
  // window — once we run the file through canvas, all metadata is gone.
  const exif = await readExifMetadata(file);

  // Skip compression if already small enough (still emit sidecar so backend
  // can use the metadata even when no canvas re-encode happens).
  if (file.size < SKIP_IF_UNDER_BYTES) {
    return { file, sidecar: exif ? buildSidecarFile(file.name, exif) : null };
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
        // fallback — return original (which still has EXIF)
        resolve({ file, sidecar: exif ? buildSidecarFile(file.name, exif) : null });
        return;
      }

      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        (blob) => {
          // Free canvas pixel buffer immediately (don't wait for GC)
          canvas.width = 0;
          canvas.height = 0;

          if (!blob || blob.size >= file.size) {
            resolve({ file, sidecar: exif ? buildSidecarFile(file.name, exif) : null });
            return;
          }
          const name = file.name.replace(/\.(heic|heif|png|bmp|tiff?)$/i, ".jpg");
          const compressed = new File([blob], name, { type: "image/jpeg", lastModified: Date.now() });
          resolve({ file: compressed, sidecar: exif ? buildSidecarFile(name, exif) : null });
        },
        "image/jpeg",
        quality
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      // fallback — return original (still has EXIF) on decode failure (e.g. HEIC on some browsers)
      resolve({ file, sidecar: exif ? buildSidecarFile(file.name, exif) : null });
    };

    img.src = url;
  });
}

/**
 * Compress multiple image files with bounded concurrency.
 * Limits to 4 simultaneous canvas operations to avoid OOM on mobile.
 *
 * Returns `{photos, sidecars}` so the upload caller can route them
 * separately — sidecars MUST NOT end up in `claims.photo_files[]` or
 * the Photo Review UI will count them as photos.
 */
export async function compressImages(
  files: File[],
  maxDimension = DEFAULT_MAX_DIMENSION,
  quality = DEFAULT_QUALITY
): Promise<{ photos: File[]; sidecars: File[] }> {
  const CONCURRENCY = 4;
  const results: CompressedPhoto[] = new Array(files.length);
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

  const photos = results.map((r) => r.file);
  const sidecars = results
    .map((r) => r.sidecar)
    .filter((s): s is File => s !== null);
  return { photos, sidecars };
}

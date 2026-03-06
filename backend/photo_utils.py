"""
Photo Utilities — Shared by Claims & Repair Processors
========================================================
One module for all photo handling: format conversion, resizing, ZIP
extraction, PDF image extraction. Both pipelines use the same code
so every format supported in one is supported in the other.

Supported input:
  Images:  HEIC, HEIF, TIFF, TIF, BMP, RAW, CR2, NEF, ARW,
           JPG, JPEG, PNG, GIF, WEBP
  Archives: ZIP (extracts all images inside, including nested folders)
  Documents: PDF (extracts embedded photos via pdfimages or PyMuPDF)
  Email: EML (extracts PDF/image/ZIP attachments from saved emails)
"""

from __future__ import annotations

import os
import glob
import zipfile
import subprocess
from typing import List, Optional


# ===================================================================
# SUPPORTED FORMATS
# ===================================================================

# Formats that need conversion to JPEG before Claude API or PDF embedding
NEEDS_CONVERSION = frozenset({
    "heic", "heif", "tiff", "tif", "bmp",
    "raw", "cr2", "nef", "arw", "dng", "orf", "rw2",
})

# Formats that are natively supported (no conversion needed, just resize)
NATIVE_IMAGE = frozenset({
    "jpg", "jpeg", "png", "gif", "webp",
})

# All image formats we accept
ALL_IMAGE_FORMATS = NATIVE_IMAGE | NEEDS_CONVERSION

# Archive/document formats that contain images
CONTAINER_FORMATS = frozenset({"zip", "pdf", "eml"})

# Everything we accept
ALL_ACCEPTED = ALL_IMAGE_FORMATS | CONTAINER_FORMATS


def is_image_file(filename: str) -> bool:
    """Check if a filename is a supported image format."""
    ext = filename.lower().rsplit(".", 1)[-1] if "." in filename else ""
    return ext in ALL_IMAGE_FORMATS


def is_container_file(filename: str) -> bool:
    """Check if a filename is a ZIP or PDF that may contain images."""
    ext = filename.lower().rsplit(".", 1)[-1] if "." in filename else ""
    return ext in CONTAINER_FORMATS


# ===================================================================
# FORMAT CONVERSION
# ===================================================================

def convert_to_jpeg(path: str) -> str:
    """Convert any non-JPEG image to JPEG using sips (macOS).

    Returns path to the converted JPEG, or empty string on failure.
    Original file is preserved.
    """
    ext = path.lower().rsplit(".", 1)[-1] if "." in path else ""

    if ext in ("jpg", "jpeg"):
        return path  # Already JPEG

    if ext not in NEEDS_CONVERSION and ext not in ("png", "gif", "webp", "bmp"):
        return ""

    jpeg_path = path.rsplit(".", 1)[0] + ".jpg"

    # Try sips first (macOS)
    try:
        result = subprocess.run(
            ["sips", "-s", "format", "jpeg", path, "--out", jpeg_path],
            capture_output=True, timeout=30
        )
        if os.path.exists(jpeg_path) and os.path.getsize(jpeg_path) > 0:
            return jpeg_path
    except (subprocess.TimeoutExpired, FileNotFoundError, Exception):
        pass  # sips not available (Linux) — fall through to Pillow

    # Pillow fallback (cross-platform)
    try:
        # Register HEIC/HEIF support if available
        if ext in ("heic", "heif"):
            try:
                from pillow_heif import register_heif_opener
                register_heif_opener()
            except ImportError:
                print(f"[PHOTO_UTILS] pillow-heif not installed — cannot convert {ext}")
                return ""
        from PIL import Image
        with Image.open(path) as img:
            if img.mode in ("RGBA", "P", "LA"):
                img = img.convert("RGB")
            elif img.mode != "RGB":
                img = img.convert("RGB")
            img.save(jpeg_path, "JPEG", quality=85)
        if os.path.exists(jpeg_path) and os.path.getsize(jpeg_path) > 0:
            return jpeg_path
    except Exception as e:
        print(f"[PHOTO_UTILS] Pillow conversion error ({ext}): {e}")

    print(f"[PHOTO_UTILS] Conversion failed for {os.path.basename(path)} ({ext})")
    return ""


def resize_photo(path: str, max_dim: int = 1024, quality: int = 70,
                 suffix: str = "_web", force: bool = False) -> str:
    """Resize a photo to max_dim on longest side, output as JPEG.

    Args:
        path: Source image path
        max_dim: Maximum dimension in pixels
        quality: JPEG quality (1-100)
        suffix: Appended to base filename for the output
        force: If False, skip files already under 500KB

    Returns path to resized copy, or original path if resize unnecessary/failed.
    """
    ext = path.lower().rsplit(".", 1)[-1] if "." in path else ""

    # Convert non-native formats first
    if ext in NEEDS_CONVERSION:
        converted = convert_to_jpeg(path)
        if not converted:
            return ""
        path = converted

    ext = path.lower().rsplit(".", 1)[-1]
    if ext not in ("jpg", "jpeg", "png", "gif", "webp"):
        return path

    # Skip if already small enough (unless forced)
    if not force and os.path.getsize(path) < 500_000:
        return path

    base = path.rsplit(".", 1)[0]
    resized = f"{base}{suffix}.jpg"
    try:
        subprocess.run(
            ["sips", "-Z", str(max_dim), "-s", "format", "jpeg",
             "--setProperty", "formatOptions", str(quality), path, "--out", resized],
            capture_output=True, timeout=30
        )
        if os.path.exists(resized) and os.path.getsize(resized) > 0:
            return resized
    except Exception:
        pass
    return path


def prepare_photo_for_api(path: str, max_dim: int = 512, quality: int = 50) -> str:
    """Convert + resize a photo for Claude API submission.

    Always converts to JPEG. Aggressive compression for API payload size.
    Returns path to the prepared file, or empty string on failure.
    """
    ext = path.lower().rsplit(".", 1)[-1] if "." in path else ""

    # Convert non-native formats first
    if ext in NEEDS_CONVERSION:
        converted = convert_to_jpeg(path)
        if not converted:
            return ""
        path = converted
        ext = "jpg"

    if ext not in ("jpg", "jpeg", "png", "gif", "webp"):
        print(f"[PHOTO_UTILS] Unsupported format, skipping: {os.path.basename(path)}")
        return ""

    base = path.rsplit(".", 1)[0]
    api_path = f"{base}_api.jpg"
    try:
        subprocess.run(
            ["sips", "-Z", str(max_dim), "-s", "format", "jpeg",
             "--setProperty", "formatOptions", str(quality), path, "--out", api_path],
            capture_output=True, timeout=30
        )
        if os.path.exists(api_path) and os.path.getsize(api_path) > 0:
            return api_path
    except Exception:
        pass
    return path


def prepare_photo_for_pdf(path: str, max_dim: int = 1200, quality: int = 75) -> str:
    """Convert + resize a photo for PDF embedding.

    Higher quality than API version — photos need to look good in print.
    Returns path to the prepared file, or empty string on failure.
    """
    ext = path.lower().rsplit(".", 1)[-1] if "." in path else ""

    # Convert non-native formats first
    if ext in NEEDS_CONVERSION:
        converted = convert_to_jpeg(path)
        if not converted:
            return ""
        path = converted
        ext = "jpg"

    if ext not in ("jpg", "jpeg", "png", "gif", "webp"):
        return ""

    base = path.rsplit(".", 1)[0]
    pdf_path = f"{base}_pdf.jpg"
    try:
        subprocess.run(
            ["sips", "-Z", str(max_dim), "-s", "format", "jpeg",
             "--setProperty", "formatOptions", str(quality), path, "--out", pdf_path],
            capture_output=True, timeout=30
        )
        if os.path.exists(pdf_path) and os.path.getsize(pdf_path) > 0:
            return pdf_path
    except Exception:
        pass
    return path


# ===================================================================
# ZIP EXTRACTION
# ===================================================================

def extract_images_from_zip(zip_path: str, output_dir: str) -> List[str]:
    """Extract all image files from a ZIP archive.

    Handles nested folders, skips macOS __MACOSX metadata,
    skips tiny files (icons/thumbnails).

    Returns list of extracted image file paths.
    """
    extracted = []

    if not zipfile.is_zipfile(zip_path):
        print(f"[PHOTO_UTILS] Not a valid ZIP file: {os.path.basename(zip_path)}")
        return extracted

    try:
        with zipfile.ZipFile(zip_path, "r") as zf:
            for member in zf.namelist():
                # Skip macOS resource forks and hidden files
                if "__MACOSX" in member or os.path.basename(member).startswith("."):
                    continue

                # Skip directories
                if member.endswith("/"):
                    continue

                # Check if it's an image file
                ext = member.lower().rsplit(".", 1)[-1] if "." in member else ""
                if ext not in ALL_IMAGE_FORMATS and ext != "pdf":
                    continue

                # Extract with a flat filename to avoid nested folder issues
                # Preserve original name but ensure uniqueness
                basename = os.path.basename(member)
                out_path = os.path.join(output_dir, basename)

                # Handle filename collisions
                counter = 1
                while os.path.exists(out_path):
                    name, ext_str = os.path.splitext(basename)
                    out_path = os.path.join(output_dir, f"{name}_{counter}{ext_str}")
                    counter += 1

                # Extract the file
                with zf.open(member) as src, open(out_path, "wb") as dst:
                    dst.write(src.read())

                # Skip tiny files (icons, thumbnails) — real photos are 10KB+
                if os.path.getsize(out_path) < 10_000:
                    os.remove(out_path)
                    continue

                # If it's a PDF inside the ZIP, extract images from it recursively
                if out_path.lower().endswith(".pdf"):
                    pdf_images = extract_images_from_pdf(out_path, output_dir)
                    extracted.extend(pdf_images)
                    os.remove(out_path)  # Remove the PDF itself after extraction
                else:
                    extracted.append(out_path)

        if extracted:
            print(f"[PHOTO_UTILS] Extracted {len(extracted)} images from ZIP: {os.path.basename(zip_path)}")
    except Exception as e:
        print(f"[PHOTO_UTILS] ZIP extraction failed: {e}")

    return extracted


# ===================================================================
# PDF IMAGE EXTRACTION
# ===================================================================

def extract_images_from_pdf(pdf_path: str, output_dir: str) -> List[str]:
    """Extract images from a PDF file using pdfimages (poppler) or PyMuPDF fallback.

    Filters out small images (icons, logos, UI elements).
    Returns list of extracted image file paths.
    """
    extracted = []
    basename = os.path.splitext(os.path.basename(pdf_path))[0]
    prefix = os.path.join(output_dir, f"{basename}_")

    # Try pdfimages first (fast, high quality)
    try:
        subprocess.run(
            ["pdfimages", "-j", pdf_path, prefix],
            capture_output=True, timeout=60
        )
        for img_path in sorted(
            glob.glob(f"{prefix}*.jpg") +
            glob.glob(f"{prefix}*.ppm") +
            glob.glob(f"{prefix}*.png")
        ):
            # Convert PPM to JPEG if needed
            if img_path.endswith(".ppm"):
                jpg_path = img_path.rsplit(".", 1)[0] + ".jpg"
                try:
                    subprocess.run(
                        ["sips", "-s", "format", "jpeg", img_path, "--out", jpg_path],
                        capture_output=True, timeout=15
                    )
                    if os.path.exists(jpg_path) and os.path.getsize(jpg_path) > 0:
                        os.remove(img_path)
                        img_path = jpg_path
                except Exception:
                    pass
            # Skip small images (icons, logos, UI elements) — real photos are 50KB+
            if os.path.getsize(img_path) > 50_000:
                # Check dimensions — real photos are 400x300+
                try:
                    from PIL import Image
                    with Image.open(img_path) as im:
                        w, h = im.size
                        if w < 400 or h < 300:
                            continue  # Skip small images (logos, icons)
                        aspect = max(w, h) / max(min(w, h), 1)
                        if aspect > 3.0:
                            continue  # Skip banners/headers
                except ImportError:
                    pass  # PIL not available, keep the image
                except Exception:
                    pass  # If image can't be read, keep it
                extracted.append(img_path)

        if extracted:
            print(f"[PHOTO_UTILS] Extracted {len(extracted)} images from PDF via pdfimages: {os.path.basename(pdf_path)}")
            # Don't return yet — check if flattened pages were missed (page rendering fallback below)
    except FileNotFoundError:
        pass  # pdfimages not installed, try PyMuPDF
    except Exception as e:
        print(f"[PHOTO_UTILS] pdfimages failed: {e}")

    # PyMuPDF: embedded image extraction + page-rendering fallback for flattened PDFs
    try:
        import fitz
        doc = fitz.open(pdf_path)
        skipped = 0

        # Only do embedded extraction if pdfimages didn't already find images
        if not extracted:
            img_idx = 0
            seen_xrefs = set()

            for page_num in range(len(doc)):
                page = doc[page_num]
                for img in page.get_images(full=True):
                    xref = img[0]

                    if xref in seen_xrefs:
                        continue
                    seen_xrefs.add(xref)

                    pix = fitz.Pixmap(doc, xref)
                    if pix.n >= 5:  # CMYK — convert to RGB
                        pix = fitz.Pixmap(fitz.csRGB, pix)

                    # Skip small images — real photos are 400x300+
                    if pix.width < 400 or pix.height < 300:
                        pix = None
                        skipped += 1
                        continue

                    # Skip extreme aspect ratios (banners/headers)
                    aspect = max(pix.width, pix.height) / max(min(pix.width, pix.height), 1)
                    if aspect > 3.0:
                        pix = None
                        skipped += 1
                        continue

                    img_path = f"{prefix}p{page_num:02d}_{img_idx:03d}.jpg"
                    pix.save(img_path)
                    pix = None

                    if os.path.getsize(img_path) < 50_000:
                        os.remove(img_path)
                        skipped += 1
                    else:
                        extracted.append(img_path)
                    img_idx += 1

        # Page-rendering fallback for flattened/printed PDFs (AccuLynx exports, CompanyCam galleries)
        # When photos are rendered as page content (not embedded image objects), get_images() finds nothing.
        # Render each page as an image to capture the visual content.
        embedded_count = len(extracted)
        if embedded_count < max(len(doc) // 2, 1):  # Less than half the pages yielded images (min 1)
            rendered = 0
            for page_num in range(len(doc)):
                page = doc[page_num]
                # Skip pages that already yielded embedded images
                page_had_image = any(f"p{page_num:02d}_" in os.path.basename(p) for p in extracted)
                if page_had_image:
                    continue
                # Render page at 150 DPI (good quality, reasonable file size)
                mat = fitz.Matrix(150/72, 150/72)
                pix = page.get_pixmap(matrix=mat)
                if pix.width < 400 or pix.height < 400:
                    pix = None
                    continue
                # Skip extreme aspect ratios (banners/headers)
                aspect = max(pix.width, pix.height) / max(min(pix.width, pix.height), 1)
                if aspect > 3.0:
                    pix = None
                    continue
                img_path = f"{prefix}p{page_num:02d}_page.jpg"
                pix.save(img_path)
                pix = None
                if os.path.getsize(img_path) > 50_000:
                    extracted.append(img_path)
                    rendered += 1
                else:
                    os.remove(img_path)
            if rendered:
                print(f"[PHOTO_UTILS] Page rendering extracted {rendered} additional images from flattened PDF: {basename}")

        doc.close()
        if skipped:
            print(f"[PHOTO_UTILS] Skipped {skipped} non-photo images (logos, icons, headers)")
        if extracted:
            print(f"[PHOTO_UTILS] Extracted {len(extracted)} photos from PDF via PyMuPDF: {os.path.basename(pdf_path)}")
    except ImportError:
        print("[PHOTO_UTILS] Neither pdfimages nor PyMuPDF available — cannot extract PDF images")
    except Exception as e:
        print(f"[PHOTO_UTILS] PyMuPDF extraction failed: {e}")

    return extracted


# ===================================================================
# EML ATTACHMENT EXTRACTION
# ===================================================================

def extract_attachments_from_eml(eml_path: str, output_dir: str) -> List[str]:
    """Extract file attachments from a .eml email file.

    Uses Python's stdlib email module to parse RFC 2822 messages.
    Extracts PDFs, images, ZIPs — skips inline images (signatures),
    HTML/text body parts, and tiny files (tracking pixels, icons).

    Returns list of extracted file paths.
    """
    import email
    import email.policy

    extracted = []

    try:
        with open(eml_path, "rb") as f:
            msg = email.message_from_binary_file(f, policy=email.policy.default)

        print(f"[PHOTO_UTILS] Parsing EML: {os.path.basename(eml_path)} — Subject: {msg.get('subject', '(none)')}")

        for part in msg.walk():
            # Skip multipart containers themselves
            if part.get_content_maintype() == "multipart":
                continue

            # Skip text/html body parts (not attachments)
            if part.get_content_type() in ("text/plain", "text/html"):
                continue

            # Must have a filename to be a real attachment
            filename = part.get_filename()
            if not filename:
                continue

            # Sanitize filename — remove path separators, null bytes
            filename = filename.replace("/", "_").replace("\\", "_").replace("\x00", "")
            filename = filename.strip(". ")
            if not filename:
                continue

            # Get the file extension
            ext = filename.lower().rsplit(".", 1)[-1] if "." in filename else ""

            # Only extract files we can use (images, PDFs, ZIPs, EMLs)
            if ext not in ALL_ACCEPTED:
                print(f"[PHOTO_UTILS] EML skip non-supported: {filename}")
                continue

            # Extract the attachment content
            payload = part.get_payload(decode=True)
            if not payload:
                continue

            # Skip tiny files — tracking pixels, icons, email signatures
            if len(payload) < 5_000:
                print(f"[PHOTO_UTILS] EML skip tiny ({len(payload)}B): {filename}")
                continue

            # Write to output dir with collision handling
            out_path = os.path.join(output_dir, filename)
            counter = 1
            while os.path.exists(out_path):
                name, ext_str = os.path.splitext(filename)
                out_path = os.path.join(output_dir, f"{name}_{counter}{ext_str}")
                counter += 1

            with open(out_path, "wb") as dst:
                dst.write(payload)

            extracted.append(out_path)
            print(f"[PHOTO_UTILS] EML extracted: {os.path.basename(out_path)} ({len(payload):,}B)")

        if extracted:
            print(f"[PHOTO_UTILS] Extracted {len(extracted)} attachments from EML: {os.path.basename(eml_path)}")
        else:
            print(f"[PHOTO_UTILS] No usable attachments found in EML: {os.path.basename(eml_path)}")

    except Exception as e:
        print(f"[PHOTO_UTILS] EML parsing failed: {e}")

    return extracted


# ===================================================================
# UNIFIED PHOTO INGESTION
# ===================================================================

def ingest_photos(file_paths: List[str], output_dir: str) -> List[str]:
    """Universal photo ingestion — handles any combination of:
    - Individual image files (any format)
    - ZIP archives containing images
    - PDFs containing embedded photos

    Downloads are expected to already be on disk at file_paths.
    All extracted/converted images are placed in output_dir.

    Returns list of usable image file paths (all converted to
    standard formats the rest of the pipeline can handle).
    """
    all_photos = []

    for path in file_paths:
        if not os.path.exists(path):
            print(f"[PHOTO_UTILS] File not found: {path}")
            continue

        ext = path.lower().rsplit(".", 1)[-1] if "." in path else ""

        if ext == "zip":
            extracted = extract_images_from_zip(path, output_dir)
            all_photos.extend(extracted)

        elif ext == "pdf":
            extracted = extract_images_from_pdf(path, output_dir)
            all_photos.extend(extracted)

        elif ext == "eml":
            eml_files = extract_attachments_from_eml(path, output_dir)
            # Recursively ingest extracted attachments (PDFs, ZIPs, images, nested EMLs)
            if eml_files:
                nested = ingest_photos(eml_files, output_dir)
                all_photos.extend(nested)

        elif ext in ALL_IMAGE_FORMATS:
            # Convert non-native formats to JPEG
            if ext in NEEDS_CONVERSION:
                converted = convert_to_jpeg(path)
                if converted:
                    all_photos.append(converted)
                else:
                    print(f"[PHOTO_UTILS] Could not convert {os.path.basename(path)}")
            else:
                all_photos.append(path)

        else:
            print(f"[PHOTO_UTILS] Skipping unsupported file: {os.path.basename(path)}")

    print(f"[PHOTO_UTILS] Ingested {len(all_photos)} photos from {len(file_paths)} input files")
    return all_photos


def get_media_type(filename: str) -> str:
    """Return MIME type for a file based on extension."""
    ext = filename.lower().rsplit(".", 1)[-1] if "." in filename else ""
    return {
        "pdf": "application/pdf",
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "png": "image/png",
        "gif": "image/gif",
        "webp": "image/webp",
        "heic": "image/heic",
        "heif": "image/heif",
        "tiff": "image/tiff",
        "tif": "image/tiff",
        "bmp": "image/bmp",
        "zip": "application/zip",
        "eml": "message/rfc822",
    }.get(ext, "application/octet-stream")

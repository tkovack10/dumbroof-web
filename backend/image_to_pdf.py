"""Image → PDF conversion for uploaded documents.

When a user uploads a phone PHOTO of a document (e.g. a signed AOB), DumbRoof
turns it into a real PDF so the carrier can open it — users never convert files
themselves. The browser handles this for most cases (canvas → pdf-lib), but it
can't decode HEIC outside Safari; this module is the server-side path that works
for every browser, reusing the same pillow-heif stack as the photo pipeline
(see photo_utils.py).
"""

import io

# Raster image extensions we know how to rasterize into a single PDF page.
_IMAGE_EXTS = ("jpg", "jpeg", "png", "heic", "heif", "webp", "tiff", "tif", "bmp", "gif")


def is_convertible_image(filename: str) -> bool:
    """True if the filename looks like a raster image we can wrap into a PDF."""
    if not filename or "." not in filename:
        return False
    return filename.lower().rsplit(".", 1)[-1] in _IMAGE_EXTS


def image_bytes_to_pdf(data: bytes) -> bytes:
    """Convert raw image bytes (incl. HEIC/HEIF) to a single-page PDF.

    Honors EXIF orientation (phone photos are often rotated) and flattens to RGB
    so PIL can emit a PDF. Raises on undecodable input so the caller can fall back
    to leaving the original file in place.
    """
    # HEIC/HEIF support. Safe to call unconditionally — register_heif_opener is
    # idempotent, and we swallow the import error on the off chance pillow-heif
    # isn't present (a plain JPEG/PNG still converts fine without it).
    try:
        from pillow_heif import register_heif_opener

        register_heif_opener()
    except Exception:
        pass

    from PIL import Image, ImageOps

    with Image.open(io.BytesIO(data)) as img:
        img = ImageOps.exif_transpose(img)  # respect phone orientation
        if img.mode != "RGB":
            img = img.convert("RGB")
        out = io.BytesIO()
        img.save(out, format="PDF", resolution=150.0)
        return out.getvalue()

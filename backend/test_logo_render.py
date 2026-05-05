"""
Logo render & validation tests (E203 regression prevention).

Covers:
  - get_logo_b64: globs files, validates raster magic bytes, rejects .ai/.pdf/.svg.
  - render_logo_block: emits text fallback when logo_b64 empty (NEVER <img src="">).
  - Combined: an .ai upload in photos_dir produces a clean text-fallback PDF cover,
    not a broken alt-text render.

Run: python3 test_logo_render.py
"""

from __future__ import annotations
import os
import tempfile
import unittest

from usarm_pdf_generator import (
    _detect_raster_mime,
    get_logo_b64,
    render_logo_block,
)


# Real (small) raster magic-byte prefixes.
PNG_HEAD = b"\x89PNG\r\n\x1a\n" + b"\x00" * 56  # 64 bytes total
JPEG_HEAD = b"\xff\xd8\xff\xe0\x00\x10JFIF" + b"\x00" * 50
WEBP_HEAD = b"RIFF\x00\x00\x00\x00WEBP" + b"\x00" * 50
GIF89A_HEAD = b"GIF89a" + b"\x00" * 58

# Non-raster heads we expect get_logo_b64 to REJECT.
AI_HEAD = b"%PDF-1.6\r%\xe2\xe3\xcf\xd3\r\n1 0 obj\r<<" + b"\x00" * 30  # Adobe Illustrator
PDF_HEAD = b"%PDF-1.7\n" + b"\x00" * 55
SVG_HEAD = b"<?xml version='1.0'?><svg xmlns='http://www.w3.org/2000/svg'/>" + b"\x00" * 5
EPS_HEAD = b"%!PS-Adobe-3.0 EPSF-3.0\n" + b"\x00" * 40


class DetectRasterMimeTests(unittest.TestCase):
    def test_png_detected(self):
        self.assertEqual(_detect_raster_mime(PNG_HEAD), "image/png")

    def test_jpeg_detected(self):
        self.assertEqual(_detect_raster_mime(JPEG_HEAD), "image/jpeg")

    def test_webp_detected(self):
        self.assertEqual(_detect_raster_mime(WEBP_HEAD), "image/webp")

    def test_gif_detected(self):
        self.assertEqual(_detect_raster_mime(GIF89A_HEAD), "image/gif")

    def test_riff_without_webp_rejected(self):
        # RIFF prefix but not WEBP — could be WAV. Must not pass.
        head = b"RIFF\x00\x00\x00\x00WAVE" + b"\x00" * 50
        self.assertEqual(_detect_raster_mime(head), "")

    def test_ai_pdf_rejected(self):
        self.assertEqual(_detect_raster_mime(AI_HEAD), "")

    def test_pdf_rejected(self):
        self.assertEqual(_detect_raster_mime(PDF_HEAD), "")

    def test_svg_rejected(self):
        self.assertEqual(_detect_raster_mime(SVG_HEAD), "")

    def test_eps_rejected(self):
        self.assertEqual(_detect_raster_mime(EPS_HEAD), "")

    def test_empty_rejected(self):
        self.assertEqual(_detect_raster_mime(b""), "")


class GetLogoB64Tests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.photos = self._tmp.name
        self.config = {"_paths": {"photos": self.photos}}

    def tearDown(self):
        self._tmp.cleanup()

    def _write(self, name: str, content: bytes):
        path = os.path.join(self.photos, name)
        with open(path, "wb") as f:
            f.write(content)
        return path

    def test_no_logo_returns_empty(self):
        self.assertEqual(get_logo_b64(self.config), "")

    def test_png_returns_data_uri(self):
        self._write("usarm_logo.png", PNG_HEAD)
        result = get_logo_b64(self.config)
        self.assertTrue(result.startswith("data:image/png;base64,"))

    def test_jpeg_with_jpg_extension(self):
        self._write("usarm_logo.jpg", JPEG_HEAD)
        result = get_logo_b64(self.config)
        self.assertTrue(result.startswith("data:image/jpeg;base64,"))

    def test_ai_file_with_ai_extension_rejected(self):
        # The Team Builders bug: a .ai file (which is a PDF wrapper) was
        # downloaded into photos_dir as usarm_logo.ai. Must NOT be embedded
        # as a base64 data URI — Chrome can't render it in <img>.
        self._write("usarm_logo.ai", AI_HEAD)
        self.assertEqual(get_logo_b64(self.config), "")

    def test_ai_renamed_to_png_still_rejected(self):
        # Defense-in-depth: even if user renames a .ai to .png, magic-byte
        # validation catches it.
        self._write("usarm_logo.png", AI_HEAD)
        self.assertEqual(get_logo_b64(self.config), "")

    def test_picks_first_valid_when_multiple(self):
        self._write("usarm_logo.ai", AI_HEAD)
        self._write("usarm_logo.png", PNG_HEAD)
        result = get_logo_b64(self.config)
        self.assertTrue(result.startswith("data:image/png;base64,"))


class RenderLogoBlockTests(unittest.TestCase):
    def test_with_logo_emits_img_tag(self):
        out = render_logo_block("data:image/png;base64,iVBORw0KGgoA",
                                 "Team Builders", css_class="cover-logo")
        self.assertIn('<img src="data:image/png;base64,iVBORw0KGgoA"', out)
        self.assertIn('alt="Team Builders"', out)
        self.assertIn('class="cover-logo"', out)

    def test_empty_logo_emits_text_fallback(self):
        out = render_logo_block("", "Team Builders", css_class="cover-logo")
        # Critical: must NOT emit <img src=""> which renders alt-text.
        self.assertNotIn("<img", out)
        self.assertIn('logo-text-fallback', out)
        self.assertIn('cover-logo', out)
        self.assertIn('Team Builders', out)

    def test_inline_style_preserved(self):
        out = render_logo_block(
            "data:image/png;base64,iVBORw0KGgoA",
            "Acme",
            css_class="logo-img",
            inline_style="height:60pt; width:auto;",
        )
        self.assertIn('style="height:60pt; width:auto;"', out)

    def test_inline_style_propagates_to_text_fallback(self):
        out = render_logo_block(
            "", "Acme",
            css_class="logo-img",
            inline_style="height:60pt;",
        )
        self.assertIn('logo-text-fallback', out)
        self.assertIn('height:60pt', out)

    def test_blank_company_name_safe(self):
        out = render_logo_block("", "", css_class="cover-logo")
        # Should still produce a div (just empty), never a broken <img>.
        self.assertNotIn("<img", out)
        self.assertIn('logo-text-fallback', out)


if __name__ == "__main__":
    unittest.main()

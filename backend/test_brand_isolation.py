"""
Brand-isolation smoke tests (E182 regression prevention).

Verifies that the bundled USARM logo NEVER ends up in a non-USARM
user's photos_dir, and that USARM team members still get the bundled
fallback when they don't have their own logo on file.

Run: python3 test_brand_isolation.py
"""

from __future__ import annotations
import os
import sys
import tempfile
import unittest
from brand_isolation import stage_usarm_fallback_logo


class BrandIsolationTests(unittest.TestCase):
    def setUp(self):
        self._tmpdir = tempfile.TemporaryDirectory()
        self.photos_dir = self._tmpdir.name
        # Realistic stand-in for the bundled USARM logo file
        self._bundle_dir = tempfile.TemporaryDirectory()
        self.bundled_usarm = os.path.join(self._bundle_dir.name, "bundled_usarm_logo.jpg")
        with open(self.bundled_usarm, "wb") as f:
            f.write(b"\xff\xd8\xff\xe0FAKE_JPEG_USARM_LOGO")

    def tearDown(self):
        self._tmpdir.cleanup()
        self._bundle_dir.cleanup()

    # ── E182 regression cases — the four states that matter ──────────────

    def test_non_usarm_no_user_logo_does_not_leak_usarm(self):
        """The most important assertion: non-USARM user with no logo MUST
        NOT get the bundled USARM logo. This was the E182 leak."""
        result = stage_usarm_fallback_logo(
            self.photos_dir,
            user_logo_downloaded=False,
            is_usarm=False,
            bundled_logo_paths=[self.bundled_usarm],
        )
        self.assertIsNone(result)
        self.assertEqual(
            os.listdir(self.photos_dir),
            [],
            f"BRAND LEAK: photos_dir should be empty for non-USARM user "
            f"with no logo, but contains: {os.listdir(self.photos_dir)}",
        )

    def test_non_usarm_user_with_logo_keeps_their_logo(self):
        """Non-USARM user uploaded their own logo. Fallback must NOT
        overwrite it."""
        user_logo = os.path.join(self.photos_dir, "usarm_logo.png")
        with open(user_logo, "wb") as f:
            f.write(b"\x89PNG\r\nFAKE_PNG_USER_LOGO")

        result = stage_usarm_fallback_logo(
            self.photos_dir,
            user_logo_downloaded=True,
            is_usarm=False,
            bundled_logo_paths=[self.bundled_usarm],
        )
        self.assertIsNone(result)
        self.assertTrue(os.path.exists(user_logo))
        with open(user_logo, "rb") as f:
            self.assertEqual(f.read(), b"\x89PNG\r\nFAKE_PNG_USER_LOGO")
        self.assertEqual(os.listdir(self.photos_dir), ["usarm_logo.png"])

    def test_usarm_no_user_logo_gets_bundled_fallback(self):
        """USARM team member without their own logo SHOULD get the
        bundled USARM logo."""
        result = stage_usarm_fallback_logo(
            self.photos_dir,
            user_logo_downloaded=False,
            is_usarm=True,
            bundled_logo_paths=[self.bundled_usarm],
        )
        expected = os.path.join(self.photos_dir, "usarm_logo.jpg")
        self.assertEqual(result, expected)
        with open(expected, "rb") as f:
            self.assertIn(b"FAKE_JPEG_USARM_LOGO", f.read())

    def test_usarm_user_with_logo_keeps_their_logo(self):
        """USARM team member with custom logo keeps THEIR logo."""
        user_logo = os.path.join(self.photos_dir, "usarm_logo.jpeg")
        with open(user_logo, "wb") as f:
            f.write(b"\xff\xd8\xff\xe0CUSTOM_USARM_LOGO")

        result = stage_usarm_fallback_logo(
            self.photos_dir,
            user_logo_downloaded=True,
            is_usarm=True,
            bundled_logo_paths=[self.bundled_usarm],
        )
        self.assertIsNone(result)
        with open(user_logo, "rb") as f:
            self.assertEqual(f.read(), b"\xff\xd8\xff\xe0CUSTOM_USARM_LOGO")

    # ── Edge cases ───────────────────────────────────────────────────────

    def test_bundled_logo_missing_does_not_create_empty_file(self):
        """If none of the bundled paths exist on disk, fallback returns
        None instead of creating an empty placeholder."""
        result = stage_usarm_fallback_logo(
            self.photos_dir,
            user_logo_downloaded=False,
            is_usarm=True,
            bundled_logo_paths=["/nonexistent/path/usarm_logo.jpg"],
        )
        self.assertIsNone(result)
        self.assertEqual(os.listdir(self.photos_dir), [])

    def test_glob_check_catches_existing_jpeg_logo(self):
        """A user-downloaded `.jpeg` (the original E182 trigger) blocks
        the fallback even when is_usarm=True. The bug was the original
        existence check only matched `.jpg`."""
        user_logo = os.path.join(self.photos_dir, "usarm_logo.jpeg")
        with open(user_logo, "wb") as f:
            f.write(b"\xff\xd8USER_JPEG")

        # user_logo_downloaded=False simulates a partial-download or
        # mid-flight crash where the bool wasn't set. Glob check should
        # still catch it.
        result = stage_usarm_fallback_logo(
            self.photos_dir,
            user_logo_downloaded=False,
            is_usarm=True,
            bundled_logo_paths=[self.bundled_usarm],
        )
        self.assertIsNone(result)
        self.assertEqual(sorted(os.listdir(self.photos_dir)), ["usarm_logo.jpeg"])

    def test_glob_check_catches_existing_png_logo(self):
        user_logo = os.path.join(self.photos_dir, "usarm_logo.png")
        with open(user_logo, "wb") as f:
            f.write(b"\x89PNGUSER_PNG")
        result = stage_usarm_fallback_logo(
            self.photos_dir,
            user_logo_downloaded=False,
            is_usarm=True,
            bundled_logo_paths=[self.bundled_usarm],
        )
        self.assertIsNone(result)

    def test_first_existing_bundled_path_wins(self):
        """When multiple bundled paths are passed, the first existing one
        is used (preference order)."""
        primary = os.path.join(self._bundle_dir.name, "primary.jpg")
        secondary = os.path.join(self._bundle_dir.name, "secondary.jpg")
        with open(primary, "wb") as f:
            f.write(b"PRIMARY_LOGO")
        with open(secondary, "wb") as f:
            f.write(b"SECONDARY_LOGO")

        result = stage_usarm_fallback_logo(
            self.photos_dir,
            user_logo_downloaded=False,
            is_usarm=True,
            bundled_logo_paths=[primary, secondary],
        )
        self.assertIsNotNone(result)
        with open(result, "rb") as f:
            self.assertEqual(f.read(), b"PRIMARY_LOGO")

    def test_skip_missing_first_path_falls_through_to_second(self):
        """If the first bundled path doesn't exist, the second is used."""
        secondary = os.path.join(self._bundle_dir.name, "secondary.jpg")
        with open(secondary, "wb") as f:
            f.write(b"SECONDARY_LOGO")
        result = stage_usarm_fallback_logo(
            self.photos_dir,
            user_logo_downloaded=False,
            is_usarm=True,
            bundled_logo_paths=["/nonexistent/primary.jpg", secondary],
        )
        self.assertIsNotNone(result)
        with open(result, "rb") as f:
            self.assertEqual(f.read(), b"SECONDARY_LOGO")


if __name__ == "__main__":
    sys.exit(0 if unittest.main(exit=False, verbosity=2).result.wasSuccessful() else 1)

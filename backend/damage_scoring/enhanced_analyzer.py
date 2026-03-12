"""
Enhanced analyzer that wraps hail_detection.analyzer and adds scoring passes.
Runs the 4 new Claude Vision prompts for damage scoring data.
"""

import os
import re
import json
import base64
import anthropic
from pathlib import Path
from typing import Optional, Dict, List, Any, Tuple

from damage_scoring.prompts import (
    SHINGLE_IDENTIFICATION_PROMPT,
    MULTI_PHOTO_COMPARISON_PROMPT,
    SCORING_SEVERITY_DEEP_PROMPT,
    DOCUMENTATION_QUALITY_PROMPT,
)

MODEL = "claude-sonnet-4-20250514"
MAX_TOKENS = 4096


def _encode_image(photo_path: str) -> Tuple[str, str]:
    """Encode image to base64 with media type."""
    ext = Path(photo_path).suffix.lower()
    media_types = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".gif": "image/gif",
        ".webp": "image/webp",
    }
    media_type = media_types.get(ext, "image/jpeg")
    with open(photo_path, "rb") as f:
        data = base64.b64encode(f.read()).decode("utf-8")
    return data, media_type


def _parse_json_response(text: str) -> dict:
    """Parse JSON from Claude response, handling markdown code blocks."""
    # Try markdown code block first
    match = re.search(r"```(?:json)?\s*\n?(.*?)\n?```", text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(1))
        except json.JSONDecodeError:
            pass
    # Try raw JSON
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    # Try extracting first {...}
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError:
            pass
    return {}


def _call_vision(
    client: anthropic.Anthropic,
    prompt: str,
    images: List[Tuple[str, str]],
    model: str = MODEL,
    sb=None, claim_id: str = None, step_name: str = "damage_scoring_vision",
) -> dict:
    """Call Claude Vision with one or more images."""
    content = []
    for data, media_type in images:
        content.append({
            "type": "image",
            "source": {"type": "base64", "media_type": media_type, "data": data},
        })
    content.append({"type": "text", "text": prompt})

    kwargs = dict(model=model, max_tokens=MAX_TOKENS,
                  messages=[{"role": "user", "content": content}])
    # Use telemetry if Supabase client available
    if sb:
        try:
            from telemetry import call_claude_logged
            response = call_claude_logged(client, sb, claim_id, step_name=step_name, **kwargs)
            return _parse_json_response(response.content[0].text)
        except ImportError:
            pass
    response = client.messages.create(**kwargs)
    return _parse_json_response(response.content[0].text)


class EnhancedAnalyzer:
    """Wraps hail_detection analysis and adds scoring-specific Vision passes."""

    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or os.environ.get("ANTHROPIC_API_KEY")
        self.client = anthropic.Anthropic(api_key=self.api_key)

    def discover_photos(self, claim_dir: str) -> List[str]:
        """Find all photos in a claim directory."""
        photos_dir = os.path.join(claim_dir, "photos")
        if not os.path.isdir(photos_dir):
            return []
        extensions = {".jpg", ".jpeg", ".png", ".gif", ".webp"}
        photos = []
        for f in sorted(os.listdir(photos_dir)):
            if Path(f).suffix.lower() in extensions and f != "usarm_logo.jpg":
                photos.append(os.path.join(photos_dir, f))
        return photos

    def identify_shingle(self, photo_path: str) -> dict:
        """Run SHINGLE_IDENTIFICATION_PROMPT on a single photo."""
        data, media_type = _encode_image(photo_path)
        result = _call_vision(self.client, SHINGLE_IDENTIFICATION_PROMPT, [(data, media_type)])
        return result

    def compare_photos(self, photo_paths: List[str], max_photos: int = 4) -> dict:
        """Run MULTI_PHOTO_COMPARISON_PROMPT on 2-4 photos."""
        images = []
        for path in photo_paths[:max_photos]:
            data, media_type = _encode_image(path)
            images.append((data, media_type))
        if len(images) < 2:
            return {"error": "Need at least 2 photos for comparison"}
        result = _call_vision(self.client, MULTI_PHOTO_COMPARISON_PROMPT, images)
        return result

    def deep_severity(self, photo_path: str) -> dict:
        """Run SCORING_SEVERITY_DEEP_PROMPT on a single photo."""
        data, media_type = _encode_image(photo_path)
        result = _call_vision(self.client, SCORING_SEVERITY_DEEP_PROMPT, [(data, media_type)])
        return result

    def documentation_quality(self, photo_path: str) -> dict:
        """Run DOCUMENTATION_QUALITY_PROMPT on a single photo."""
        data, media_type = _encode_image(photo_path)
        result = _call_vision(self.client, DOCUMENTATION_QUALITY_PROMPT, [(data, media_type)])
        return result

    def run_scoring_analysis(
        self,
        claim_dir: str,
        deep: bool = False,
        max_severity_photos: int = 5,
        max_quality_photos: int = 3,
    ) -> Dict[str, Any]:
        """
        Run all scoring-relevant analyses on a claim's photos.

        Args:
            claim_dir: Path to claim directory
            deep: If True, run all prompts on more photos (higher cost)
            max_severity_photos: Max photos for deep severity analysis
            max_quality_photos: Max photos for quality analysis

        Returns:
            Dict with all analysis results for scoring
        """
        photos = self.discover_photos(claim_dir)
        if not photos:
            print("  No photos found in claim directory.")
            return {"error": "no_photos", "photos_found": 0}

        print(f"  Found {len(photos)} photos for scoring analysis")
        results = {
            "photos_found": len(photos),
            "shingle_id": None,
            "photo_comparison": None,
            "severity_analyses": [],
            "quality_analyses": [],
        }

        # Pass 1: Shingle identification (first close-up roof photo)
        print("  Pass 1: Shingle identification...")
        roof_photos = [p for p in photos if self._is_roof_photo(p)]
        id_photo = roof_photos[0] if roof_photos else photos[0]
        print(f"    Analyzing {os.path.basename(id_photo)}...", end=" ", flush=True)
        results["shingle_id"] = self.identify_shingle(id_photo)
        print("done")

        # Pass 2: Multi-photo comparison (select diverse photos)
        if len(photos) >= 2:
            print("  Pass 2: Multi-photo comparison...")
            comparison_photos = self._select_diverse_photos(photos, max_count=4)
            results["photo_comparison"] = self.compare_photos(comparison_photos)
            print(f"    Compared {len(comparison_photos)} photos")

        # Pass 3: Deep severity analysis
        severity_count = max_severity_photos if deep else min(3, len(roof_photos))
        severity_photos = roof_photos[:severity_count] if roof_photos else photos[:severity_count]
        if severity_photos:
            print(f"  Pass 3: Deep severity analysis ({len(severity_photos)} photos)...")
            for i, photo in enumerate(severity_photos):
                print(f"    [{i+1}/{len(severity_photos)}] {os.path.basename(photo)}...", end=" ", flush=True)
                severity = self.deep_severity(photo)
                severity["photo"] = os.path.basename(photo)
                results["severity_analyses"].append(severity)
                print("done")

        # Pass 4: Documentation quality (sample)
        quality_count = max_quality_photos if deep else min(2, len(photos))
        quality_photos = photos[:quality_count]
        if quality_photos:
            print(f"  Pass 4: Documentation quality ({len(quality_photos)} photos)...")
            for i, photo in enumerate(quality_photos):
                print(f"    [{i+1}/{len(quality_photos)}] {os.path.basename(photo)}...", end=" ", flush=True)
                quality = self.documentation_quality(photo)
                quality["photo"] = os.path.basename(photo)
                results["quality_analyses"].append(quality)
                print("done")

        return results

    def _is_roof_photo(self, photo_path: str) -> bool:
        """Heuristic: roof photos tend to have certain naming patterns."""
        name = os.path.basename(photo_path).lower()
        roof_keywords = ["roof", "shingle", "surface", "damage", "hit", "impact", "chalk"]
        return any(kw in name for kw in roof_keywords)

    def _select_diverse_photos(self, photos: List[str], max_count: int = 4) -> List[str]:
        """Select diverse photos for comparison (spread across the set)."""
        if len(photos) <= max_count:
            return photos
        # Take evenly spaced photos
        step = len(photos) / max_count
        indices = [int(i * step) for i in range(max_count)]
        return [photos[i] for i in indices]

    def get_hail_analysis(self, claim_dir: str) -> Optional[dict]:
        """
        Try to get existing hail_detection analysis results from claim config.
        Returns the hail_analysis section if it exists.
        """
        config_path = os.path.join(claim_dir, "claim_config.json")
        if not os.path.isfile(config_path):
            return None
        try:
            with open(config_path, "r") as f:
                config = json.load(f)
            return config.get("hail_analysis")
        except (json.JSONDecodeError, IOError):
            return None

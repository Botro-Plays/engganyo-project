"""Optional NSFW image detection.

Strategy (best available wins):
  1. `nudenet` (pip install nudenet) - real neural detector, recommended.
  2. Pillow skin-tone heuristic - lightweight fallback, high false-positive rate; only flags very high ratios.
"""
from __future__ import annotations

import io
import logging
import tempfile
import os

log = logging.getLogger(__name__)
_detector = None
_tried = False
BAD_LABELS = {"FEMALE_BREAST_EXPOSED", "FEMALE_GENITALIA_EXPOSED", "MALE_GENITALIA_EXPOSED", "ANUS_EXPOSED",
              "BUTTOCKS_EXPOSED", "MALE_BREAST_EXPOSED"}


def _get_detector():
    global _detector, _tried
    if _tried:
        return _detector
    _tried = True
    try:
        from nudenet import NudeDetector  # type: ignore
        _detector = NudeDetector()
        log.info("NudeNet detector loaded")
    except Exception:
        log.info("nudenet not installed - using heuristic NSFW fallback")
    return _detector


def _heuristic(data: bytes) -> float:
    try:
        from PIL import Image
        im = Image.open(io.BytesIO(data)).convert("YCbCr").resize((96, 96))
    except Exception:
        return 0.0
    px = list(im.getdata())
    skin = sum(1 for y, cb, cr in px if 80 <= cb <= 120 and 133 <= cr <= 173 and y > 60)
    return skin / len(px)


def nsfw_score(data: bytes) -> float:
    """0..1 probability-ish score."""
    det = _get_detector()
    if det is not None:
        try:
            with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as f:
                f.write(data)
                path = f.name
            try:
                res = det.detect(path)
            finally:
                os.unlink(path)
            best = max((r["score"] for r in res if r["class"] in BAD_LABELS), default=0.0)
            return float(best)
        except Exception as e:  # noqa
            log.debug("nudenet failed: %s", e)
    ratio = _heuristic(data)
    return 0.95 if ratio > 0.62 else 0.0


def is_nsfw(data: bytes, threshold: float = 0.6) -> bool:
    return nsfw_score(data) >= threshold

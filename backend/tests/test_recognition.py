"""
Acceptance tests for the face recognition stage (Phase 1).

    python -m tests.test_recognition

Validates the two claims the pipeline depends on, against your own photographs
in tests/fixtures/:

    same_person/       two different photos of one person  -> MATCH
    different_person/  two different people                -> NON-MATCH

Thresholds come from app.services.face_processor and are OpenCV's published
SFace operating points. This runner deliberately never adjusts them - if a pair
fails, the fix is in detection/alignment/embedding, not in the threshold.
"""

import os
import sys
import glob
from typing import List, Optional, Tuple

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.services.face_processor import (  # noqa: E402
    embed_primary_face,
    evaluate_face_similarity,
    models_ready,
    SFACE_COSINE_THRESHOLD,
    SFACE_L2_THRESHOLD,
)

FIXTURE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures")
IMAGE_GLOBS = ("*.jpg", "*.jpeg", "*.png", "*.webp", "*.bmp")

GREEN, RED, YELLOW, DIM, RESET = "\033[92m", "\033[91m", "\033[93m", "\033[2m", "\033[0m"


def find_images(folder: str) -> List[str]:
    paths: List[str] = []
    for pattern in IMAGE_GLOBS:
        paths.extend(glob.glob(os.path.join(folder, pattern)))
    return sorted(paths)


def load_bgr(path: str) -> np.ndarray:
    # imread ignores EXIF rotation; go through the same decoder the API uses so
    # the test exercises the production path rather than a parallel one.
    from app.services.face_processor import decode_base64_image
    import base64

    with open(path, "rb") as fh:
        b64 = base64.b64encode(fh.read()).decode()
    return decode_base64_image(b64)


def describe(path: str, result: dict) -> str:
    det = result["detection"]
    return (
        f"{DIM}    {os.path.basename(path):<28}{RESET} "
        f"{result['image_width']}x{result['image_height']}  "
        f"faces={result['face_count']}  "
        f"score={det.score:.3f}  "
        f"box=({det.box['left']},{det.box['top']})-({det.box['right']},{det.box['bottom']})  "
        f"aligned={result['aligned'].shape[1]}x{result['aligned'].shape[0]}"
    )


def run_pair(folder: str, label: str, expect_match: bool) -> Optional[bool]:
    print(f"\n{'-' * 74}")
    print(f"  {label}")
    print(f"{'-' * 74}")

    images = find_images(folder)
    if len(images) < 2:
        print(f"{YELLOW}  SKIPPED{RESET} - needs 2 images in {folder}")
        print(f"{DIM}           found {len(images)}. See tests/fixtures/README.md{RESET}")
        return None

    a_path, b_path = images[0], images[1]

    try:
        a = embed_primary_face(load_bgr(a_path))
        print(describe(a_path, a))
    except Exception as e:
        print(f"{RED}  FAIL{RESET} - no usable face in {os.path.basename(a_path)}: {e}")
        return False

    try:
        b = embed_primary_face(load_bgr(b_path))
        print(describe(b_path, b))
    except Exception as e:
        print(f"{RED}  FAIL{RESET} - no usable face in {os.path.basename(b_path)}: {e}")
        return False

    is_match, sim_pct, l2, cosine = evaluate_face_similarity(a["embedding"], b["embedding"])

    print()
    print(f"    cosine similarity : {cosine:+.4f}   (match needs >= {SFACE_COSINE_THRESHOLD})")
    print(f"    L2 distance       : {l2:.4f}   (match needs <= {SFACE_L2_THRESHOLD})")
    print(f"    similarity        : {sim_pct:.2f}%")
    print(f"    verdict           : {'MATCH' if is_match else 'NON-MATCH'}")
    print(f"    expected          : {'MATCH' if expect_match else 'NON-MATCH'}")

    passed = is_match == expect_match
    print(f"\n  {GREEN + 'PASS' + RESET if passed else RED + 'FAIL' + RESET}")
    return passed


def main() -> int:
    info = models_ready()
    print("=" * 74)
    print("  FACE RECOGNITION ACCEPTANCE TESTS")
    print("=" * 74)
    print(f"  detector   : {info['detector'] or RED + 'NOT LOADED' + RESET}")
    print(f"  recognizer : {info['recognizer'] or RED + 'NOT LOADED' + RESET}")
    print(f"  thresholds : cosine >= {SFACE_COSINE_THRESHOLD} | L2 <= {SFACE_L2_THRESHOLD}")

    if not (info["detector_loaded"] and info["recognizer_loaded"]):
        print(f"\n{RED}Models are not loaded; cannot run.{RESET}")
        return 2

    results = [
        run_pair(os.path.join(FIXTURE_DIR, "same_person"),
                 "TEST 1  same person, two photos  ->  expect MATCH", True),
        run_pair(os.path.join(FIXTURE_DIR, "different_person"),
                 "TEST 2  two different people     ->  expect NON-MATCH", False),
    ]

    ran = [r for r in results if r is not None]
    passed = [r for r in ran if r]

    print(f"\n{'=' * 74}")
    if not ran:
        print(f"{YELLOW}  No fixtures found - add your photos to tests/fixtures/{RESET}")
        print(f"{DIM}  See tests/fixtures/README.md{RESET}")
        print("=" * 74)
        return 3

    print(f"  {len(passed)}/{len(ran)} passed"
          + (f"  ({len(results) - len(ran)} skipped)" if len(ran) < len(results) else ""))
    print("=" * 74)
    return 0 if len(passed) == len(ran) else 1


if __name__ == "__main__":
    sys.exit(main())

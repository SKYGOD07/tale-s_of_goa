"""
Face detection and recognition.

This is the official OpenCV Zoo pipeline, not a bespoke one:

    YuNet.detect()        -> bounding box + 5 facial landmarks
    SFace.alignCrop()     -> landmark-aligned 112x112 crop
    SFace.feature()       -> 128-D identity embedding
    SFace.match()         -> cosine / L2 distance

Alignment is the part that matters. SFace is trained on faces warped to a
canonical position using the five landmarks; feeding it a loosely padded
detector box that has merely been resized to 112x112 costs most of its
discriminative power, which is what produced same-person cosine scores
around 0.17. There is deliberately no fallback embedding: if a model is
missing the pipeline raises, rather than silently degrading to something
that cannot recognise anyone.
"""

import base64
import io
import os
from dataclasses import dataclass, field
from typing import List, Tuple, Dict, Any, Optional

import cv2
import numpy as np
from PIL import Image, ImageOps

_MODEL_DIR = os.path.dirname(os.path.abspath(__file__))
_YUNET_MODEL_PATH = os.path.join(_MODEL_DIR, "face_detection_yunet_2023mar.onnx")
_SFACE_MODEL_PATH = os.path.join(_MODEL_DIR, "face_recognition_sface_2021dec.onnx")

# OpenCV's published operating points for SFace. cosine >= 0.363 and
# L2 <= 1.128 are the same decision boundary: for unit vectors
# L2 = sqrt(2 * (1 - cosine)), and sqrt(2 * (1 - 0.363)) = 1.1287.
SFACE_COSINE_THRESHOLD = 0.363
SFACE_L2_THRESHOLD = 1.128

# YuNet confidence floor. 0.6 keeps profile and partially lit faces that 0.9
# discards, while still rejecting texture noise.
YUNET_SCORE_THRESHOLD = 0.6
YUNET_NMS_THRESHOLD = 0.3
YUNET_TOP_K = 5000

# The distance-type enum moved between OpenCV releases; resolve it once here
# rather than pinning a name that varies by version.
_DIS_COSINE = getattr(cv2, "FaceRecognizerSF_FR_COSINE",
                      getattr(cv2, "FaceRecognizerSF_DisType_FR_COSINE", 0))
_DIS_NORM_L2 = getattr(cv2, "FaceRecognizerSF_FR_NORM_L2",
                       getattr(cv2, "FaceRecognizerSF_DisType_FR_NORM_L2", 1))

MODEL_NAME_DETECTOR = "YuNet (face_detection_yunet_2023mar.onnx)"
MODEL_NAME_RECOGNIZER = "SFace (face_recognition_sface_2021dec.onnx)"


class ModelUnavailable(RuntimeError):
    """Raised when a required ONNX model is missing or will not load."""


def _load_detector() -> Optional[cv2.FaceDetectorYN]:
    if not os.path.exists(_YUNET_MODEL_PATH):
        print(f"[FACE] YuNet model missing at {_YUNET_MODEL_PATH}")
        return None
    try:
        det = cv2.FaceDetectorYN.create(
            _YUNET_MODEL_PATH, "", (320, 320),
            YUNET_SCORE_THRESHOLD, YUNET_NMS_THRESHOLD, YUNET_TOP_K,
        )
        print(f"[FACE] YuNet DNN face detector loaded from {_YUNET_MODEL_PATH}")
        return det
    except Exception as e:
        print(f"[FACE] YuNet failed to load: {e}")
        return None


def _load_recognizer() -> Optional[cv2.FaceRecognizerSF]:
    if not os.path.exists(_SFACE_MODEL_PATH):
        print(f"[FACE] SFace model missing at {_SFACE_MODEL_PATH}")
        return None
    try:
        rec = cv2.FaceRecognizerSF.create(_SFACE_MODEL_PATH, "")
        print(f"[FACE] SFace DNN face recognizer loaded from {_SFACE_MODEL_PATH}")
        return rec
    except Exception as e:
        print(f"[FACE] SFace failed to load: {e}")
        return None


_DETECTOR = _load_detector()
_RECOGNIZER = _load_recognizer()


def models_ready() -> Dict[str, Any]:
    """Reported by the API so the UI can state which models are actually in use."""
    return {
        "detector": MODEL_NAME_DETECTOR if _DETECTOR is not None else None,
        "recognizer": MODEL_NAME_RECOGNIZER if _RECOGNIZER is not None else None,
        "detector_loaded": _DETECTOR is not None,
        "recognizer_loaded": _RECOGNIZER is not None,
        "embedding_dimension": 128,
        "normalization": "L2 unit norm",
        "cosine_threshold": SFACE_COSINE_THRESHOLD,
        "l2_threshold": SFACE_L2_THRESHOLD,
    }


@dataclass
class FaceDetection:
    """One detected face: the box for display, the raw YuNet row for alignment."""
    box: Dict[str, int]
    score: float
    landmarks: List[Tuple[int, int]] = field(default_factory=list)
    # YuNet's 15-value row [x, y, w, h, 5x(lx, ly), score]. alignCrop needs it
    # verbatim, so it is carried through rather than reconstructed from the box.
    raw: Optional[np.ndarray] = None

    @property
    def width(self) -> int:
        return self.box["right"] - self.box["left"]

    @property
    def height(self) -> int:
        return self.box["bottom"] - self.box["top"]


# ─────────────────────────────────────────────────────────────────────────
# Image IO
# ─────────────────────────────────────────────────────────────────────────

def decode_base64_image(base64_string: str) -> np.ndarray:
    """Decodes base64 (with or without data URL prefix) into an OpenCV BGR array."""
    if not base64_string or not isinstance(base64_string, str):
        raise ValueError("Image base64 string is empty or invalid")

    if ',' in base64_string:
        base64_string = base64_string.split(',')[1]
    base64_string = base64_string.strip()

    image_bytes = base64.b64decode(base64_string)
    image = Image.open(io.BytesIO(image_bytes))
    # Photos off a phone or camera are stored unrotated with an EXIF Orientation
    # tag describing the turn. Applying it must happen before convert(), which
    # drops the EXIF block; otherwise portrait photos arrive sideways.
    image = ImageOps.exif_transpose(image)
    image = image.convert('RGB')
    return cv2.cvtColor(np.array(image), cv2.COLOR_RGB2BGR)


def encode_image_to_base64(img_ndarray: np.ndarray, format_ext: str = ".jpg") -> str:
    """Encodes an OpenCV BGR or grayscale array into a base64 data URL."""
    if img_ndarray is None or img_ndarray.size == 0:
        return ""
    success, buffer = cv2.imencode(format_ext, img_ndarray, [cv2.IMWRITE_JPEG_QUALITY, 90])
    if not success:
        return ""
    b64_str = base64.b64encode(buffer).decode('utf-8')
    return f"data:image/jpeg;base64,{b64_str}"


def extract_pixel_stats(image_bgr: np.ndarray, crop_bgr: Optional[np.ndarray] = None) -> Dict[str, Any]:
    """
    Extracts numerical pixel metrics, color space representations (RGB, BGR, Hex, Grayscale),
    and image dimensions for educational visualization.
    """
    h, w, c = image_bgr.shape
    total_pixels = int(h * w)
    total_bytes = int(total_pixels * c)

    target_img = crop_bgr if (crop_bgr is not None and crop_bgr.size > 0) else image_bgr
    th, tw, _ = target_img.shape

    sample_coords = [
        (0, 0),
        (max(0, th // 4), max(0, tw // 4)),
        (max(0, th // 2), max(0, tw // 2)),
        (max(0, 3 * th // 4), max(0, 3 * tw // 4)),
        (max(0, min(th - 1, 10)), max(0, min(tw - 1, 10))),
        (max(0, th // 2), max(0, tw // 4)),
    ]

    sample_pixels = []
    seen = set()
    for y, x in sample_coords:
        if 0 <= y < th and 0 <= x < tw and (x, y) not in seen:
            seen.add((x, y))
            b, g, r = int(target_img[y, x, 0]), int(target_img[y, x, 1]), int(target_img[y, x, 2])
            gray_val = int(round(0.299 * r + 0.587 * g + 0.114 * b))
            hex_val = f"#{r:02X}{g:02X}{b:02X}"
            sample_pixels.append({
                "coordinate": f"({x}, {y})",
                "rgb": f"RGB({r}, {g}, {b})",
                "bgr": f"BGR({b}, {g}, {r})",
                "grayscale": gray_val,
                "hex": hex_val
            })

    crop_pixels = int(crop_bgr.shape[0] * crop_bgr.shape[1]) if crop_bgr is not None else None

    return {
        "image_width": int(w),
        "image_height": int(h),
        "total_pixels": total_pixels,
        "channels": int(c),
        "total_bytes": total_bytes,
        "face_crop_width": int(crop_bgr.shape[1]) if crop_bgr is not None else None,
        "face_crop_height": int(crop_bgr.shape[0]) if crop_bgr is not None else None,
        "face_crop_pixels": crop_pixels,
        # The aligned crop SFace actually consumes is 112x112.
        "standardized_grid_pixels": 112 * 112,
        "sample_pixels": sample_pixels
    }


def process_face_transformations(face_bgr: np.ndarray) -> Tuple[str, str, str]:
    """
    Generates Base64 previews for the 3 stages:
    1. RGB Face Crop
    2. 8-Bit Grayscale Face Crop (cv2.COLOR_BGR2GRAY)
    3. Histogram Equalized Face Matrix (cv2.equalizeHist)

    These are visualisation only. The embedding is computed from the aligned
    colour crop, never from these grayscale previews.
    """
    if face_bgr is None or face_bgr.size == 0:
        return "", "", ""

    rgb_crop_b64 = encode_image_to_base64(face_bgr)
    gray_face = cv2.cvtColor(face_bgr, cv2.COLOR_BGR2GRAY)
    gray_crop_b64 = encode_image_to_base64(gray_face)
    equalized_face = cv2.equalizeHist(gray_face)
    equalized_crop_b64 = encode_image_to_base64(equalized_face)

    return rgb_crop_b64, gray_crop_b64, equalized_crop_b64


# ─────────────────────────────────────────────────────────────────────────
# Detection
# ─────────────────────────────────────────────────────────────────────────

def detect_faces_detailed(image_bgr: np.ndarray) -> Tuple[List[FaceDetection], int, int]:
    """
    Runs YuNet over the full image and returns every face, largest first.

    No centre-crop, no square assumption, no aspect-ratio massaging: the
    detector sees the image at its own resolution and the boxes come back in
    original image coordinates.
    """
    if _DETECTOR is None:
        raise ModelUnavailable(
            f"YuNet detector not available. Expected {_YUNET_MODEL_PATH}. "
            "Download face_detection_yunet_2023mar.onnx from the OpenCV Zoo."
        )
    if image_bgr is None or image_bgr.size == 0:
        raise ValueError("Empty image supplied to the face detector")

    height, width = image_bgr.shape[:2]

    # YuNet is fully convolutional but wants the input size declared. Very large
    # photos are scaled down for detection only - the boxes are mapped back, so
    # the crop is still taken from the original pixels.
    max_side = 1024
    scale = min(1.0, max_side / max(width, height))
    if scale < 1.0:
        det_img = cv2.resize(image_bgr, (int(width * scale), int(height * scale)),
                             interpolation=cv2.INTER_AREA)
    else:
        det_img = image_bgr

    dh, dw = det_img.shape[:2]
    _DETECTOR.setInputSize((dw, dh))
    _, raw_faces = _DETECTOR.detect(det_img)

    detections: List[FaceDetection] = []
    if raw_faces is not None:
        inv = 1.0 / scale
        for row in raw_faces:
            x, y, w, h = row[0:4]
            score = float(row[14])

            landmarks = [
                (int(round(row[4 + i * 2] * inv)), int(round(row[5 + i * 2] * inv)))
                for i in range(5)
            ]

            box = {
                "top": max(0, int(round(y * inv))),
                "left": max(0, int(round(x * inv))),
                "bottom": min(height, int(round((y + h) * inv))),
                "right": min(width, int(round((x + w) * inv))),
            }
            if box["right"] <= box["left"] or box["bottom"] <= box["top"]:
                continue

            # alignCrop consumes the row in detector coordinates, so keep a copy
            # rescaled to the original image alongside it.
            raw = row.copy()
            if scale < 1.0:
                raw[0:14] = raw[0:14] * inv

            detections.append(
                FaceDetection(box=box, score=score, landmarks=landmarks, raw=raw)
            )

    detections.sort(key=lambda d: d.width * d.height, reverse=True)
    return detections, width, height


def detect_faces(image_bgr: np.ndarray) -> Tuple[List[Dict[str, int]], int, int]:
    """Backwards-compatible wrapper returning plain boxes."""
    detections, width, height = detect_faces_detailed(image_bgr)
    return [d.box for d in detections], width, height


def crop_face_region(image_bgr: np.ndarray, box: Dict[str, int], padding_pct: float = 0.15) -> np.ndarray:
    """
    Padded box crop, for display only.

    Recognition does NOT use this - it uses align_face(), because a padded box
    is not what SFace was trained on.
    """
    h_img, w_img = image_bgr.shape[:2]
    top, right, bottom, left = box["top"], box["right"], box["bottom"], box["left"]

    pad_h = int((bottom - top) * padding_pct)
    pad_w = int((right - left) * padding_pct)

    crop_top = max(0, top - pad_h)
    crop_bottom = min(h_img, bottom + pad_h)
    crop_left = max(0, left - pad_w)
    crop_right = min(w_img, right + pad_w)

    return image_bgr[crop_top:crop_bottom, crop_left:crop_right]


# ─────────────────────────────────────────────────────────────────────────
# Alignment + embedding
# ─────────────────────────────────────────────────────────────────────────

def align_face(image_bgr: np.ndarray, detection: FaceDetection) -> np.ndarray:
    """Warps the face to SFace's canonical 112x112 using the 5 landmarks."""
    if _RECOGNIZER is None:
        raise ModelUnavailable(
            f"SFace recognizer not available. Expected {_SFACE_MODEL_PATH}."
        )
    if detection.raw is None:
        raise ValueError("Detection carries no landmark row; cannot align.")
    return _RECOGNIZER.alignCrop(image_bgr, detection.raw)


def encode_aligned_face(aligned_bgr: np.ndarray) -> np.ndarray:
    """SFace feature for an already-aligned 112x112 crop. Returns a 1x128 float32."""
    if _RECOGNIZER is None:
        raise ModelUnavailable("SFace recognizer not available.")
    if aligned_bgr is None or aligned_bgr.size == 0:
        raise ValueError("Empty aligned crop supplied to the recognizer")
    return _RECOGNIZER.feature(aligned_bgr)


def encode_face(image_bgr: np.ndarray, detection: FaceDetection) -> Tuple[np.ndarray, np.ndarray]:
    """
    Full detection -> identity path: align, then embed.

    Every caller uses this, so a webcam frame and an uploaded photo are
    processed identically end to end.
    """
    aligned = align_face(image_bgr, detection)
    feature = encode_aligned_face(aligned)
    return aligned, feature


def feature_to_list(feature: np.ndarray) -> List[float]:
    """
    L2-normalised 128 floats, for display and for the canonical hash.

    SFace.match() normalises internally for both metrics, so storing the unit
    vector loses nothing and makes the stored record scale-independent.
    """
    vec = np.asarray(feature, dtype=np.float64).flatten()
    norm = np.linalg.norm(vec)
    if norm > 0:
        vec = vec / norm
    return [float(np.round(v, 6)) for v in vec]


def list_to_feature(embedding: List[float]) -> np.ndarray:
    """Rebuilds a 1x128 float32 feature from a stored embedding list."""
    return np.asarray(embedding, dtype=np.float32).reshape(1, -1)


# ─────────────────────────────────────────────────────────────────────────
# Matching
# ─────────────────────────────────────────────────────────────────────────

def match_features(feature_a: np.ndarray, feature_b: np.ndarray) -> Tuple[float, float]:
    """
    Returns (cosine_similarity, l2_distance) using SFace's own match().

    Both metrics normalise internally, so they are two views of one decision
    boundary rather than independent signals.
    """
    if _RECOGNIZER is None:
        raise ModelUnavailable("SFace recognizer not available.")
    a = np.asarray(feature_a, dtype=np.float32).reshape(1, -1)
    b = np.asarray(feature_b, dtype=np.float32).reshape(1, -1)
    cosine = float(_RECOGNIZER.match(a, b, _DIS_COSINE))
    l2 = float(_RECOGNIZER.match(a, b, _DIS_NORM_L2))
    return cosine, l2


def compute_euclidean_distance(embedding_a: List[float], embedding_b: List[float]) -> float:
    """L2 distance between two stored embeddings, via SFace.match()."""
    _, l2 = match_features(list_to_feature(embedding_a), list_to_feature(embedding_b))
    return round(l2, 4)


def compute_cosine_similarity(embedding_a: List[float], embedding_b: List[float]) -> float:
    """Cosine similarity between two stored embeddings, via SFace.match()."""
    cosine, _ = match_features(list_to_feature(embedding_a), list_to_feature(embedding_b))
    return round(cosine, 4)


def similarity_percentage(cosine: float) -> float:
    """
    Cosine mapped onto 0-100 with the decision threshold pinned at 50%.

    Raw cosine x 100 was misleading: it made a genuine match at the 0.363
    boundary read as '36%', which looks like a failure. Here anything at or
    above the threshold reads >= 50%.
    """
    if cosine >= SFACE_COSINE_THRESHOLD:
        span = 1.0 - SFACE_COSINE_THRESHOLD
        pct = 50.0 + 50.0 * ((cosine - SFACE_COSINE_THRESHOLD) / span if span > 0 else 0.0)
    else:
        lo = -1.0
        span = SFACE_COSINE_THRESHOLD - lo
        pct = 50.0 * ((cosine - lo) / span if span > 0 else 0.0)
    return round(max(0.0, min(100.0, pct)), 2)


def evaluate_face_similarity(
    embedding_a: List[float],
    embedding_b: List[float],
    threshold: Optional[float] = None,
) -> Tuple[bool, float, float, float]:
    """
    Match verdict for two stored embeddings.

    `threshold` is an L2 distance, defaulting to SFace's published 1.128.
    Returns (is_match, similarity_percentage, euclidean_distance, cosine_similarity).
    """
    l2_threshold = SFACE_L2_THRESHOLD if threshold is None else float(threshold)

    cosine, l2 = match_features(list_to_feature(embedding_a), list_to_feature(embedding_b))
    is_match = bool(l2 <= l2_threshold)

    return is_match, similarity_percentage(cosine), round(l2, 4), round(cosine, 4)


# ─────────────────────────────────────────────────────────────────────────
# Convenience: image -> single best face embedding
# ─────────────────────────────────────────────────────────────────────────

def embed_primary_face(
    image_bgr: np.ndarray,
    face_index: int = 0,
    crop_region: Optional[Dict[str, int]] = None,
) -> Dict[str, Any]:
    """
    Detect, align and embed a face in an image.

    The one entry point used by the comparison, registration and web-discovery
    paths, so a live frame, an uploaded photo and a downloaded candidate image
    all traverse exactly the same code.

    By default the largest face is used. Two manual overrides exist for photos
    the detector reads differently from the operator:

      crop_region  {left, top, right, bottom} in ORIGINAL image coordinates.
                   The image is cropped to this box first, so the operator can
                   point at one person in a group shot or at a small or off-centre face
                   the auto-pick skipped. Detection then runs inside the crop.
      face_index   Which detected face to use, ordered largest first. Useful
                   when two faces are present and the wrong one wins on area.

    Boxes are always reported back in ORIGINAL image coordinates, so an overlay
    drawn against the uploaded picture still lines up after a manual crop.

    Raises ValueError when no face is found - callers must not substitute a
    whole-image embedding, which is not a face embedding at all.
    """
    full_h, full_w = image_bgr.shape[:2]

    off_x = off_y = 0
    work = image_bgr
    if crop_region:
        left = max(0, min(int(crop_region.get("left", 0)), full_w - 1))
        top = max(0, min(int(crop_region.get("top", 0)), full_h - 1))
        right = max(left + 1, min(int(crop_region.get("right", full_w)), full_w))
        bottom = max(top + 1, min(int(crop_region.get("bottom", full_h)), full_h))
        work = image_bgr[top:bottom, left:right]
        off_x, off_y = left, top
        if work.size == 0:
            raise ValueError("The supplied crop region is empty")

    detections, _, _ = detect_faces_detailed(work)
    if not detections:
        raise ValueError(
            "No face detected in the selected region"
            if crop_region else "No face detected in the supplied image"
        )

    if not 0 <= face_index < len(detections):
        raise ValueError(
            f"face_index {face_index} is out of range; {len(detections)} face(s) detected"
        )

    primary = detections[face_index]

    # Embed from the cropped frame (that is where the landmarks are valid),
    # then translate the reported boxes back into original coordinates.
    aligned, feature = encode_face(work, primary)
    display_crop = crop_face_region(work, primary.box)

    if off_x or off_y:
        for det in detections:
            det.box = {
                "top": det.box["top"] + off_y,
                "bottom": det.box["bottom"] + off_y,
                "left": det.box["left"] + off_x,
                "right": det.box["right"] + off_x,
            }
            det.landmarks = [(x + off_x, y + off_y) for (x, y) in det.landmarks]

    return {
        "detection": primary,
        "detections": detections,
        "aligned": aligned,
        "feature": feature,
        "embedding": feature_to_list(feature),
        "display_crop": display_crop,
        "image_width": full_w,
        "image_height": full_h,
        "face_count": len(detections),
        "face_index": face_index,
        "crop_region": crop_region,
    }


def describe_pipeline(image_bgr: np.ndarray, result: Dict[str, Any], source: str) -> Dict[str, Any]:
    """Per-run diagnostics, surfaced through the API so the UI can show real numbers."""
    det: FaceDetection = result["detection"]
    return {
        "source": source,
        "image_width": result["image_width"],
        "image_height": result["image_height"],
        "faces_detected": result["face_count"],
        "selected_box": det.box,
        "detection_score": round(det.score, 4),
        "landmarks": det.landmarks,
        "aligned_crop_size": [int(result["aligned"].shape[1]), int(result["aligned"].shape[0])],
        "detector_model": MODEL_NAME_DETECTOR,
        "recognizer_model": MODEL_NAME_RECOGNIZER,
        "embedding_dimension": len(result["embedding"]),
        "normalization": "L2 unit norm",
    }

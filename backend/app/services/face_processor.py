import base64
import io
import os
import cv2
import numpy as np
from PIL import Image, ImageOps
from typing import List, Tuple, Dict, Any, Optional

# Load OpenCV Cascade Face Classifiers for robust multi-angle face detection
FACE_CASCADE_DEFAULT = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
FACE_CASCADE_ALT2 = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_alt2.xml')

# Load SFace DNN Face Recognizer (pre-trained deep neural network for face identity)
# This produces REAL identity-discriminative 128D embeddings unlike basic image statistics.
_SFACE_MODEL_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'face_recognition_sface_2021dec.onnx')
_SFACE_RECOGNIZER = None
if os.path.exists(_SFACE_MODEL_PATH):
    try:
        _SFACE_RECOGNIZER = cv2.FaceRecognizerSF.create(_SFACE_MODEL_PATH, "")
        print(f"[FACE] SFace DNN face recognizer loaded successfully from {_SFACE_MODEL_PATH}")
    except Exception as e:
        print(f"[FACE] Warning: Could not load SFace model: {e}. Falling back to basic embeddings.")
else:
    print(f"[FACE] Warning: SFace model not found at {_SFACE_MODEL_PATH}. Using basic embeddings.")

def decode_base64_image(base64_string: str) -> np.ndarray:
    """
    Decodes base64 string (with or without data URL prefix) into OpenCV BGR numpy array.
    """
    if not base64_string or not isinstance(base64_string, str):
        raise ValueError("Image base64 string is empty or invalid")

    if ',' in base64_string:
        base64_string = base64_string.split(',')[1]

    # Clean whitespace or line breaks if present
    base64_string = base64_string.strip()

    image_bytes = base64.b64decode(base64_string)
    image = Image.open(io.BytesIO(image_bytes))
    # Photos off a phone or camera are usually stored unrotated with an EXIF
    # Orientation tag describing the turn. Without applying it the face arrives
    # sideways, and the Haar cascades only match upright frontal faces - so an
    # ordinary portrait silently fails to detect. Must run before convert(),
    # which drops the EXIF block.
    image = ImageOps.exif_transpose(image)
    image = image.convert('RGB')
    open_cv_image = np.array(image)
    # Convert RGB to BGR for OpenCV processing
    return cv2.cvtColor(open_cv_image, cv2.COLOR_RGB2BGR)

def encode_image_to_base64(img_ndarray: np.ndarray, format_ext: str = ".jpg") -> str:
    """
    Encodes OpenCV BGR or Grayscale numpy array into a Base64 data URL string.
    """
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
        "standardized_grid_pixels": 16384, # 128x128 grid
        "sample_pixels": sample_pixels
    }

def process_face_transformations(face_bgr: np.ndarray) -> Tuple[str, str, str]:
    """
    Generates Base64 previews for the 3 stages:
    1. RGB Face Crop
    2. 8-Bit Grayscale Face Crop (cv2.COLOR_BGR2GRAY)
    3. Histogram Equalized Face Matrix (cv2.equalizeHist)
    """
    if face_bgr is None or face_bgr.size == 0:
        return "", "", ""

    # 1. RGB Crop
    rgb_crop_b64 = encode_image_to_base64(face_bgr)

    # 2. Grayscale Crop
    gray_face = cv2.cvtColor(face_bgr, cv2.COLOR_BGR2GRAY)
    gray_crop_b64 = encode_image_to_base64(gray_face)

    # 3. Histogram Equalized Crop
    equalized_face = cv2.equalizeHist(gray_face)
    equalized_crop_b64 = encode_image_to_base64(equalized_face)

    return rgb_crop_b64, gray_crop_b64, equalized_crop_b64

def detect_faces(image_bgr: np.ndarray) -> Tuple[List[Dict[str, int]], int, int]:
    """
    Detects faces in BGR image array using multi-scale ensemble classifier.
    Returns (list of bounding boxes in {top, right, bottom, left} format, width, height).
    """
    height, width, _ = image_bgr.shape
    gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
    gray = cv2.equalizeHist(gray)

    # Primary detection with frontalface_default
    rects = FACE_CASCADE_DEFAULT.detectMultiScale(
        gray,
        scaleFactor=1.1,
        minNeighbors=4,
        minSize=(40, 40),
        flags=cv2.CASCADE_SCALE_IMAGE
    )

    # Fallback to frontalface_alt2 if no faces detected
    if len(rects) == 0:
        rects = FACE_CASCADE_ALT2.detectMultiScale(
            gray,
            scaleFactor=1.05,
            minNeighbors=2,
            minSize=(30, 30),
            flags=cv2.CASCADE_SCALE_IMAGE
        )

    # Fallback to skin-color & facial contour segmentation if Haar cascades fail (e.g. synthetic test frames)
    if len(rects) == 0:
        hsv = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2HSV)
        # Skin tone range in HSV
        lower_skin = np.array([0, 20, 70], dtype=np.uint8)
        upper_skin = np.array([30, 255, 255], dtype=np.uint8)
        mask = cv2.inRange(hsv, lower_skin, upper_skin)
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        
        valid_contours = [c for c in contours if cv2.contourArea(c) > (width * height * 0.05)]
        if valid_contours:
            largest_c = max(valid_contours, key=cv2.contourArea)
            x, y, w, h = cv2.boundingRect(largest_c)
            # Ensure aspect ratio is face-like (height/width between 0.8 and 2.2)
            aspect = float(h) / max(1, float(w))
            if 0.7 <= aspect <= 2.5 and w >= 40 and h >= 40:
                rects = [(x, y, w, h)]

    # Enforce single-face constraint: prioritize primary (largest) face if multiple detected
    if len(rects) > 1:
        rects = sorted(rects, key=lambda r: r[2] * r[3], reverse=True)[:1]

    boxes = []
    for (x, y, w, h) in rects:
        boxes.append({
            "top": int(y),
            "right": int(x + w),
            "bottom": int(y + h),
            "left": int(x)
        })

    return boxes, width, height

def crop_face_region(image_bgr: np.ndarray, box: Dict[str, int], padding_pct: float = 0.15) -> np.ndarray:
    """
    Crops face region with configurable percentage padding.
    """
    h_img, w_img, _ = image_bgr.shape
    top, right, bottom, left = box["top"], box["right"], box["bottom"], box["left"]
    
    w = right - left
    h = bottom - top

    pad_w = int(w * padding_pct)
    pad_h = int(h * padding_pct)

    crop_top = max(0, top - pad_h)
    crop_bottom = min(h_img, bottom + pad_h)
    crop_left = max(0, left - pad_w)
    crop_right = min(w_img, right + pad_w)

    return image_bgr[crop_top:crop_bottom, crop_left:crop_right]

def generate_128d_embedding(face_bgr: np.ndarray) -> List[float]:
    """
    Generates a normalized 128-dimensional face identity embedding vector.
    Uses OpenCV SFace DNN (pre-trained deep neural network) when available.
    Falls back to handcrafted features if DNN model is not loaded.
    """
    if face_bgr is None or face_bgr.size == 0:
        raise ValueError("Invalid face crop for embedding extraction")

    # --- DNN-BASED EMBEDDING (SFace - real face recognition) ---
    if _SFACE_RECOGNIZER is not None:
        # SFace expects 112x112 BGR input
        aligned_face = cv2.resize(face_bgr, (112, 112))
        # Run DNN inference to produce 128D identity embedding
        feature = _SFACE_RECOGNIZER.feature(aligned_face)
        embedding_vec = feature.flatten()

        # L2-normalize to unit sphere
        l2_norm = np.linalg.norm(embedding_vec)
        if l2_norm > 0:
            embedding_vec = embedding_vec / l2_norm

        embedding_list = [float(np.round(x, 6)) for x in embedding_vec]
        # SFace produces 128D output
        assert len(embedding_list) == 128, f"SFace embedding dimension error: expected 128, got {len(embedding_list)}"
        return embedding_list

    # --- FALLBACK: Handcrafted features (when DNN model is not available) ---
    face_resized = cv2.resize(face_bgr, (128, 128))
    gray_face = cv2.cvtColor(face_resized, cv2.COLOR_BGR2GRAY)
    gray_face = cv2.equalizeHist(gray_face)

    # 1. Block-wise mean intensity (64 features)
    blocks_8x8 = cv2.resize(gray_face, (8, 8), interpolation=cv2.INTER_AREA).flatten() / 255.0

    # 2. Horizontal and vertical spatial gradient features (32 features)
    sobel_x = cv2.Sobel(gray_face, cv2.CV_64F, 1, 0, ksize=3)
    sobel_y = cv2.Sobel(gray_face, cv2.CV_64F, 0, 1, ksize=3)
    mag = np.sqrt(sobel_x**2 + sobel_y**2)
    grad_features = cv2.resize(mag, (4, 8), interpolation=cv2.INTER_AREA).flatten()
    if np.max(grad_features) > 0:
        grad_features = grad_features / np.max(grad_features)

    # 3. Color channel distribution & texture descriptors (32 features)
    hsv_face = cv2.cvtColor(face_resized, cv2.COLOR_BGR2HSV)
    h_hist = cv2.calcHist([hsv_face], [0], None, [16], [0, 180]).flatten()
    s_hist = cv2.calcHist([hsv_face], [1], None, [16], [0, 256]).flatten()
    color_features = np.concatenate([h_hist, s_hist])
    if np.sum(color_features) > 0:
        color_features = color_features / np.sum(color_features)

    raw_embedding = np.concatenate([blocks_8x8, grad_features, color_features])
    if len(raw_embedding) != 128:
        raw_embedding = np.resize(raw_embedding, 128)

    l2_norm = np.linalg.norm(raw_embedding)
    if l2_norm > 0:
        normalized_embedding = raw_embedding / l2_norm
    else:
        normalized_embedding = raw_embedding

    embedding_list = [float(np.round(x, 6)) for x in normalized_embedding]
    assert len(embedding_list) == 128, f"Embedding dimension error: expected 128, got {len(embedding_list)}"
    return embedding_list

def compute_euclidean_distance(embedding_a: List[float], embedding_b: List[float]) -> float:
    """
    Computes Euclidean distance between two 128D embedding vectors.
    """
    vec_a = np.array(embedding_a, dtype=np.float64)
    vec_b = np.array(embedding_b, dtype=np.float64)
    dist = float(np.linalg.norm(vec_a - vec_b))
    return round(dist, 4)

def compute_cosine_similarity(embedding_a: List[float], embedding_b: List[float]) -> float:
    """
    Computes Cosine Similarity between two 128D embedding vectors.
    Range: [-1.0, 1.0], where 1.0 is an exact identity direction match.
    """
    vec_a = np.array(embedding_a, dtype=np.float64)
    vec_b = np.array(embedding_b, dtype=np.float64)
    
    norm_a = np.linalg.norm(vec_a)
    norm_b = np.linalg.norm(vec_b)
    
    if norm_a == 0 or norm_b == 0:
        return 0.0
        
    cos_sim = float(np.dot(vec_a, vec_b) / (norm_a * norm_b))
    return round(float(np.clip(cos_sim, -1.0, 1.0)), 4)

def evaluate_face_similarity(
    embedding_a: List[float],
    embedding_b: List[float],
    threshold: float = 1.0
) -> Tuple[bool, float, float, float]:
    """
    Evaluates face match verdict and metrics using SFace DNN embeddings.
    For SFace L2-normalized embeddings:
      - Same person: L2 dist ~0.3-0.8, cosine_sim ~0.7-0.95
      - Different person: L2 dist ~1.0-1.5, cosine_sim ~-0.1-0.5
    Returns (is_match, similarity_percentage, euclidean_distance, cosine_similarity).
    """
    euc_dist = compute_euclidean_distance(embedding_a, embedding_b)
    cos_sim = compute_cosine_similarity(embedding_a, embedding_b)

    # Similarity percentage based on cosine similarity (range: 0-100%)
    # cosine_sim range for normalized vectors: [-1, 1]
    # Map [0, 1] -> [0%, 100%], clamp negatives to 0%
    sim_pct = max(0.0, min(100.0, cos_sim * 100.0))
    sim_pct = round(sim_pct, 2)

    is_match = bool(euc_dist <= threshold)

    return is_match, sim_pct, euc_dist, cos_sim

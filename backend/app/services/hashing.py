import json
import hashlib
from datetime import datetime, timezone
from typing import List, Tuple, Dict, Any, Optional

def create_biometric_record(
    embedding: List[float],
    dimension: int = 128,
    model_name: str = "SFace(face_recognition_sface_2021dec.onnx)+YuNet(face_detection_yunet_2023mar.onnx)"
) -> Dict[str, Any]:
    """
    Creates a canonical structured single-face biometric record.
    """
    return {
        "version": "1.0",
        "record_type": "SINGLE_FACE_ENCODING",
        "embedding_dimension": dimension,
        "embedding": [round(float(v), 6) for v in embedding],
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "model": model_name,
    }

def create_comparison_record(
    embedding_a: List[float],
    embedding_b: List[float],
    similarity_percentage: float,
    euclidean_distance: float,
    cosine_similarity: float,
    is_match: bool,
    threshold: float,
    model_name: str = "SFace(face_recognition_sface_2021dec.onnx)+YuNet(face_detection_yunet_2023mar.onnx)"
) -> Dict[str, Any]:
    """
    Creates a canonical structured 1-to-1 face verification comparison record.
    Includes deterministic hashes of both embeddings, comparison metrics, and verification verdict.
    """
    # Deterministic SHA-256 for individual embeddings
    hash_a = hashlib.sha256(
        json.dumps([round(float(v), 6) for v in embedding_a], separators=(',', ':')).encode('utf-8')
    ).hexdigest()

    hash_b = hashlib.sha256(
        json.dumps([round(float(v), 6) for v in embedding_b], separators=(',', ':')).encode('utf-8')
    ).hexdigest()

    return {
        "version": "1.0",
        "record_type": "1_TO_1_BIOMETRIC_VERIFICATION",
        "embedding_a_hash": hash_a,
        "embedding_b_hash": hash_b,
        "similarity_percentage": round(float(similarity_percentage), 2),
        "euclidean_distance": round(float(euclidean_distance), 4),
        "cosine_similarity": round(float(cosine_similarity), 4),
        "threshold_used": round(float(threshold), 4),
        "is_match": bool(is_match),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "model": model_name,
    }

def generate_canonical_hash(record: Dict[str, Any]) -> str:
    """
    Deterministically serializes record (sorted keys, compact separators) and computes SHA-256 hex digest.
    """
    canonical_json = json.dumps(record, sort_keys=True, separators=(',', ':'))
    hash_object = hashlib.sha256(canonical_json.encode('utf-8'))
    return hash_object.hexdigest()

def compute_record_hash(embedding: List[float]) -> Tuple[Dict[str, Any], str]:
    """
    Helper returning single face biometric record and SHA-256 hash string.
    """
    record = create_biometric_record(embedding)
    record_hash = generate_canonical_hash(record)
    return record, record_hash

def compute_comparison_record_hash(
    embedding_a: List[float],
    embedding_b: List[float],
    similarity_percentage: float,
    euclidean_distance: float,
    cosine_similarity: float,
    is_match: bool,
    threshold: float
) -> Tuple[Dict[str, Any], str]:
    """
    Helper returning 1-to-1 comparison verification record and SHA-256 hash string.
    """
    record = create_comparison_record(
        embedding_a=embedding_a,
        embedding_b=embedding_b,
        similarity_percentage=similarity_percentage,
        euclidean_distance=euclidean_distance,
        cosine_similarity=cosine_similarity,
        is_match=is_match,
        threshold=threshold
    )
    record_hash = generate_canonical_hash(record)
    return record, record_hash

from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field

class FaceBoxSchema(BaseModel):
    top: int
    right: int
    bottom: int
    left: int

class SamplePixelSchema(BaseModel):
    coordinate: str
    rgb: str
    bgr: str
    grayscale: int
    hex: str

class PixelStatsSchema(BaseModel):
    image_width: int
    image_height: int
    total_pixels: int
    channels: int
    total_bytes: int
    face_crop_width: Optional[int] = None
    face_crop_height: Optional[int] = None
    face_crop_pixels: Optional[int] = None
    standardized_grid_pixels: int = 16384
    sample_pixels: List[SamplePixelSchema] = []

class DetectRequest(BaseModel):
    image: str = Field(..., description="Base64 encoded JPEG or PNG image frame")

class DetectResponse(BaseModel):
    face_detected: bool
    face_count: int
    faces: List[FaceBoxSchema]
    status_message: str
    image_width: int
    image_height: int
    pixel_stats: Optional[PixelStatsSchema] = None
    rgb_crop_base64: Optional[str] = None
    grayscale_crop_base64: Optional[str] = None
    equalized_crop_base64: Optional[str] = None
    error: Optional[str] = None

class EncodeRequest(BaseModel):
    image: str = Field(..., description="Base64 encoded image frame for face capture")

class EncodeResponse(BaseModel):
    success: bool
    embedding_dimension: int
    embedding: List[float]
    record_hash: str
    pixel_stats: Optional[PixelStatsSchema] = None
    rgb_crop_base64: Optional[str] = None
    grayscale_crop_base64: Optional[str] = None
    equalized_crop_base64: Optional[str] = None
    error: Optional[str] = None

class VerificationRequest(BaseModel):
    record_hash: str = Field(..., description="64-character hex SHA-256 record hash (with or without 0x prefix)")

class VerificationResponse(BaseModel):
    success: bool
    record_hash: str
    transaction_hash: str
    network: str
    status: str
    timestamp: str
    block_number: Optional[int] = None
    # True when the RPC/contract/key is not configured and the result is a local
    # dry run rather than a broadcast transaction.
    simulated: bool = False
    chain_id: Optional[int] = None
    explorer_url: Optional[str] = None
    gas_used: Optional[int] = None
    error: Optional[str] = None

class CompareRequest(BaseModel):
    image_a: str = Field(..., description="Base64 encoded Camera / Live image frame")
    image_b: str = Field(..., description="Base64 encoded Reference / Social media image frame")
    # SFace's published L2 operating point. 0.60 was inherited from the old
    # unaligned embedding and is far too strict for aligned SFace features:
    # genuine same-person pairs land around 0.85, so 0.60 rejected real matches.
    threshold: Optional[float] = Field(default=1.128, description="SFace L2 distance threshold for match decision")
    auto_record_on_chain: Optional[bool] = Field(default=False, description="Automatically submit verified record to EVM blockchain")

class CompareResponse(BaseModel):
    success: bool
    is_match: bool
    similarity_percentage: float
    euclidean_distance: float
    cosine_similarity: float
    threshold_used: float
    status_message: str
    face_a_detected: bool
    face_b_detected: bool
    face_a_box: Optional[FaceBoxSchema] = None
    face_b_box: Optional[FaceBoxSchema] = None
    pixel_stats_a: Optional[PixelStatsSchema] = None
    pixel_stats_b: Optional[PixelStatsSchema] = None
    rgb_crop_a_base64: Optional[str] = None
    grayscale_crop_a_base64: Optional[str] = None
    equalized_crop_a_base64: Optional[str] = None
    rgb_crop_b_base64: Optional[str] = None
    grayscale_crop_b_base64: Optional[str] = None
    equalized_crop_b_base64: Optional[str] = None
    embedding_a: List[float] = []
    embedding_b: List[float] = []
    record_hash: str = ""
    canonical_record: Optional[Dict[str, Any]] = None
    blockchain_result: Optional[VerificationResponse] = None
    error: Optional[str] = None

class VerificationQueryResponse(BaseModel):
    record_hash: str
    exists_on_chain: bool
    timestamp: Optional[int] = None
    timestamp_iso: Optional[str] = None
    recorder: Optional[str] = None
    network: str
    chain_id: Optional[int] = None
    simulated: bool = False
    explorer_url: Optional[str] = None
    error: Optional[str] = None


class ChainStatusResponse(BaseModel):
    chain_id: int
    network: str
    rpc_url: str
    contract_address: Optional[str] = None
    explorer_url: Optional[str] = None
    configured: bool
    connected: bool
    live: bool
    account: Optional[str] = None
    balance_eth: Optional[float] = None
    block_number: Optional[int] = None
    message: str = ""


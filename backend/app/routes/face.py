from fastapi import APIRouter, HTTPException, status
from app.schemas.face import (
    DetectRequest, DetectResponse, FaceBoxSchema, PixelStatsSchema, SamplePixelSchema,
    EncodeRequest, EncodeResponse,
    CompareRequest, CompareResponse, VerificationResponse
)
from app.services.face_processor import (
    decode_base64_image, detect_faces, detect_faces_detailed, crop_face_region,
    embed_primary_face, evaluate_face_similarity, describe_pipeline,
    extract_pixel_stats, process_face_transformations
)
from app.services.hashing import compute_record_hash, compute_comparison_record_hash
from app.services.blockchain import submit_record_hash_to_blockchain

router = APIRouter(prefix="/api/face", tags=["Face Operations"])

@router.post("/detect", response_model=DetectResponse)
def detect_face_endpoint(payload: DetectRequest):
    """
    POST /api/face/detect
    Receives camera image frame (base64) and detects face locations.
    Returns bounding boxes, pixel resolution stats, RGB crop, and 8-bit Grayscale preview.
    """
    try:
        image_bgr = decode_base64_image(payload.image)
        boxes, img_w, img_h = detect_faces(image_bgr)
        face_count = len(boxes)

        rgb_b64, gray_b64, eq_b64 = None, None, None
        pixel_stats_data = None

        if face_count > 0:
            primary_crop = crop_face_region(image_bgr, boxes[0], padding_pct=0.15)
            rgb_b64, gray_b64, eq_b64 = process_face_transformations(primary_crop)
            stats = extract_pixel_stats(image_bgr, primary_crop)
            pixel_stats_data = PixelStatsSchema(
                image_width=stats["image_width"],
                image_height=stats["image_height"],
                total_pixels=stats["total_pixels"],
                channels=stats["channels"],
                total_bytes=stats["total_bytes"],
                face_crop_width=stats["face_crop_width"],
                face_crop_height=stats["face_crop_height"],
                face_crop_pixels=stats["face_crop_pixels"],
                standardized_grid_pixels=stats["standardized_grid_pixels"],
                sample_pixels=[SamplePixelSchema(**p) for p in stats["sample_pixels"]]
            )
        else:
            stats = extract_pixel_stats(image_bgr, None)
            pixel_stats_data = PixelStatsSchema(
                image_width=stats["image_width"],
                image_height=stats["image_height"],
                total_pixels=stats["total_pixels"],
                channels=stats["channels"],
                total_bytes=stats["total_bytes"],
                face_crop_width=None,
                face_crop_height=None,
                face_crop_pixels=None,
                standardized_grid_pixels=112 * 112,
                sample_pixels=[SamplePixelSchema(**p) for p in stats["sample_pixels"]]
            )

        if face_count == 0:
            status_msg = "NO FACE DETECTED"
        elif face_count == 1:
            status_msg = "FACE DETECTED"
        else:
            status_msg = "MULTIPLE FACES DETECTED — PLEASE KEEP ONLY ONE FACE IN FRAME"

        formatted_boxes = [FaceBoxSchema(**b) for b in boxes]

        return DetectResponse(
            face_detected=(face_count > 0),
            face_count=face_count,
            faces=formatted_boxes,
            status_message=status_msg,
            image_width=img_w,
            image_height=img_h,
            pixel_stats=pixel_stats_data,
            rgb_crop_base64=rgb_b64,
            grayscale_crop_base64=gray_b64,
            equalized_crop_base64=eq_b64
        )
    except Exception as e:
        print(f"[ERROR][FACE] Detection failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Face detection error: {str(e)}"
        )

@router.post("/encode", response_model=EncodeResponse)
def encode_face_endpoint(payload: EncodeRequest):
    """
    POST /api/face/encode
    Receives captured frame, extracts 128D embedding vector, and generates canonical SHA-256 hash.
    """
    try:
        image_bgr = decode_base64_image(payload.image)
        boxes, _, _ = detect_faces(image_bgr)

        if len(boxes) == 0:
            return EncodeResponse(
                success=False,
                embedding_dimension=0,
                embedding=[],
                record_hash="",
                error="No face detected in capture frame"
            )

        primary_box = boxes[0]
        face_crop = crop_face_region(image_bgr, primary_box, padding_pct=0.15)
        rgb_b64, gray_b64, eq_b64 = process_face_transformations(face_crop)
        stats = extract_pixel_stats(image_bgr, face_crop)
        pixel_stats_data = PixelStatsSchema(
            image_width=stats["image_width"],
            image_height=stats["image_height"],
            total_pixels=stats["total_pixels"],
            channels=stats["channels"],
            total_bytes=stats["total_bytes"],
            face_crop_width=stats["face_crop_width"],
            face_crop_height=stats["face_crop_height"],
            face_crop_pixels=stats["face_crop_pixels"],
            standardized_grid_pixels=stats["standardized_grid_pixels"],
            sample_pixels=[SamplePixelSchema(**p) for p in stats["sample_pixels"]]
        )

        embedding = embed_primary_face(image_bgr)["embedding"]

        if len(embedding) != 128:
            return EncodeResponse(
                success=False,
                embedding_dimension=len(embedding),
                embedding=[],
                record_hash="",
                error=f"Embedding dimension error: expected 128, got {len(embedding)}"
            )

        _, record_hash = compute_record_hash(embedding)

        return EncodeResponse(
            success=True,
            embedding_dimension=128,
            embedding=embedding,
            record_hash=record_hash,
            pixel_stats=pixel_stats_data,
            rgb_crop_base64=rgb_b64,
            grayscale_crop_base64=gray_b64,
            equalized_crop_base64=eq_b64
        )

    except Exception as e:
        print(f"[ERROR][ENCODER] Encoding pipeline exception: {e}")
        return EncodeResponse(
            success=False,
            embedding_dimension=0,
            embedding=[],
            record_hash="",
            error=str(e)
        )

@router.post("/compare", response_model=CompareResponse)
def compare_faces_endpoint(payload: CompareRequest):
    """
    POST /api/face/compare
    Complete Task #3 1-to-1 Verification Pipeline:
    Camera Image A <-> Reference Social Media Image B
    1. Detect faces in Image A and Image B
    2. Crop face regions & generate Grayscale & Equalized transforms
    3. Extract 128D embedding vectors
    4. Compute Euclidean distance & Cosine similarity
    5. Evaluate match verdict based on calibrated threshold
    6. Generate canonical verification record and SHA-256 cryptographic digest
    7. Optionally record proof on EVM smart contract
    """
    try:
        print("\n================ [1-TO-1 FACE COMPARISON PIPELINE] ================")
        img_a_bgr = decode_base64_image(payload.image_a)
        img_b_bgr = decode_base64_image(payload.image_b)

        boxes_a, _, _ = detect_faces(img_a_bgr)
        face_a_detected = len(boxes_a) > 0

        boxes_b, _, _ = detect_faces(img_b_bgr)
        face_b_detected = len(boxes_b) > 0

        if not face_a_detected:
            return CompareResponse(
                success=False,
                is_match=False,
                similarity_percentage=0.0,
                euclidean_distance=2.0,
                cosine_similarity=0.0,
                threshold_used=payload.threshold or 0.60,
                status_message="No face detected in Live Camera image (Image A)",
                face_a_detected=False,
                face_b_detected=face_b_detected,
                error="Live Camera face not detected"
            )

        if not face_b_detected:
            return CompareResponse(
                success=False,
                is_match=False,
                similarity_percentage=0.0,
                euclidean_distance=2.0,
                cosine_similarity=0.0,
                threshold_used=payload.threshold or 0.60,
                status_message="No face detected in Reference / Social image (Image B)",
                face_a_detected=True,
                face_b_detected=False,
                face_a_box=FaceBoxSchema(**boxes_a[0]),
                error="Reference image face not detected"
            )

        box_a = boxes_a[0]
        box_b = boxes_b[0]

        crop_a = crop_face_region(img_a_bgr, box_a, padding_pct=0.15)
        crop_b = crop_face_region(img_b_bgr, box_b, padding_pct=0.15)

        rgb_a_b64, gray_a_b64, eq_a_b64 = process_face_transformations(crop_a)
        rgb_b_b64, gray_b_b64, eq_b_b64 = process_face_transformations(crop_b)

        stats_a = extract_pixel_stats(img_a_bgr, crop_a)
        pixel_stats_a = PixelStatsSchema(
            image_width=stats_a["image_width"],
            image_height=stats_a["image_height"],
            total_pixels=stats_a["total_pixels"],
            channels=stats_a["channels"],
            total_bytes=stats_a["total_bytes"],
            face_crop_width=stats_a["face_crop_width"],
            face_crop_height=stats_a["face_crop_height"],
            face_crop_pixels=stats_a["face_crop_pixels"],
            standardized_grid_pixels=stats_a["standardized_grid_pixels"],
            sample_pixels=[SamplePixelSchema(**p) for p in stats_a["sample_pixels"]]
        )

        stats_b = extract_pixel_stats(img_b_bgr, crop_b)
        pixel_stats_b = PixelStatsSchema(
            image_width=stats_b["image_width"],
            image_height=stats_b["image_height"],
            total_pixels=stats_b["total_pixels"],
            channels=stats_b["channels"],
            total_bytes=stats_b["total_bytes"],
            face_crop_width=stats_b["face_crop_width"],
            face_crop_height=stats_b["face_crop_height"],
            face_crop_pixels=stats_b["face_crop_pixels"],
            standardized_grid_pixels=stats_b["standardized_grid_pixels"],
            sample_pixels=[SamplePixelSchema(**p) for p in stats_b["sample_pixels"]]
        )

        # Both images traverse the same detect -> alignCrop -> feature path,
        # so a webcam frame and an uploaded photo are never processed differently.
        result_a = embed_primary_face(img_a_bgr)
        result_b = embed_primary_face(img_b_bgr)
        emb_a = result_a["embedding"]
        emb_b = result_b["embedding"]
        print("[COMPARE] A:", describe_pipeline(img_a_bgr, result_a, "image_a"))
        print("[COMPARE] B:", describe_pipeline(img_b_bgr, result_b, "image_b"))

        threshold = payload.threshold or 0.60
        is_match, sim_pct, euc_dist, cos_sim = evaluate_face_similarity(emb_a, emb_b, threshold)
        verdict_str = "MATCH VERIFIED" if is_match else "MISMATCH / DIFFERENT IDENTITY"

        canon_record, record_hash = compute_comparison_record_hash(
            embedding_a=emb_a,
            embedding_b=emb_b,
            similarity_percentage=sim_pct,
            euclidean_distance=euc_dist,
            cosine_similarity=cos_sim,
            is_match=is_match,
            threshold=threshold
        )

        blockchain_res = None
        if payload.auto_record_on_chain:
            tx_data = submit_record_hash_to_blockchain(record_hash)
            blockchain_res = VerificationResponse(**tx_data)

        return CompareResponse(
            success=True,
            is_match=is_match,
            similarity_percentage=sim_pct,
            euclidean_distance=euc_dist,
            cosine_similarity=cos_sim,
            threshold_used=threshold,
            status_message=f"{verdict_str} ({sim_pct}% similarity)",
            face_a_detected=True,
            face_b_detected=True,
            face_a_box=FaceBoxSchema(**box_a),
            face_b_box=FaceBoxSchema(**box_b),
            pixel_stats_a=pixel_stats_a,
            pixel_stats_b=pixel_stats_b,
            rgb_crop_a_base64=rgb_a_b64,
            grayscale_crop_a_base64=gray_a_b64,
            equalized_crop_a_base64=eq_a_b64,
            rgb_crop_b_base64=rgb_b_b64,
            grayscale_crop_b_base64=gray_b_b64,
            equalized_crop_b_base64=eq_b_b64,
            embedding_a=emb_a,
            embedding_b=emb_b,
            record_hash=record_hash,
            canonical_record=canon_record,
            blockchain_result=blockchain_res
        )

    except Exception as e:
        print(f"[ERROR][COMPARE] Pipeline failed: {e}")
        return CompareResponse(
            success=False,
            is_match=False,
            similarity_percentage=0.0,
            euclidean_distance=2.0,
            cosine_similarity=0.0,
            threshold_used=payload.threshold or 0.60,
            status_message=f"Comparison pipeline error: {str(e)}",
            face_a_detected=False,
            face_b_detected=False,
            error=str(e)
        )

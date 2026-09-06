import cv2

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field
from typing import Dict, Any, List, Optional

from app.services.social_search import (
    run_social_search_and_verification_pipeline,
    fetch_post_metadata_and_image,
    NoMatchFound,
)
from app.services.face_processor import encode_image_to_base64, models_ready, SFACE_L2_THRESHOLD
from app.services.face_search import search_capabilities
from app.services.gallery import (
    gallery_summary, delete_identity, match_gallery, enroll, DivergentFace,
)
from app.services.teach import teach_identity
from app.services.face_processor import (
    decode_base64_image, embed_primary_face, evaluate_face_similarity,
)
from app.services.feedback import (
    record_feedback, feedback_stats, suggest_threshold, VALID_LABELS,
)

router = APIRouter(prefix="/api/social", tags=["Social Media Pipeline"])

class SocialSearchRequest(BaseModel):
    image: str = Field(..., description="Base64 encoded input face scan / camera frame")
    query: Optional[str] = Field("", description="Optional search query (e.g. name or social handle)")
    authorized_use: bool = Field(
        ...,
        description="Caller confirms they are authorized to search with this image.",
    )
    # L2 distance. Defaults to SFace's published operating point. The operator
    # may change it - the value actually used is recorded in the canonical
    # record that gets hashed on-chain, so any deviation is auditable rather
    # than hidden.
    threshold: Optional[float] = Field(
        SFACE_L2_THRESHOLD,
        ge=0.20, le=1.60,
        description=(
            f"SFace L2 match threshold (default {SFACE_L2_THRESHOLD}, the published "
            "operating point). Lower = stricter. Raising it above the default "
            "accepts more false matches."
        ),
    )
    # Manual overrides for photos the detector frames differently from the
    # operator: point at one person in a group shot, or pick a different face.
    face_index: Optional[int] = Field(
        0, ge=0, le=20,
        description="Which detected face to use, ordered largest first.",
    )
    crop_region: Optional[Dict[str, int]] = Field(
        None,
        description=(
            "Optional {left, top, right, bottom} in ORIGINAL image pixels. "
            "Detection runs inside this box, so the operator can point at the "
            "face to search with."
        ),
    )

class FetchUrlRequest(BaseModel):
    url: str = Field(..., description="Social media post or image URL to fetch")

@router.post("/search-and-verify")
async def search_and_verify_endpoint(payload: SocialSearchRequest):
    """
    HH GOA Task #3 - Full Automated Pipeline Endpoint:
    Face Scan Input -> Web/Social Media Search -> Find Matching Post -> Blockchain Commitment & Re-verification.
    """
    try:
        if not payload.authorized_use:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Confirm that you are authorized to use this image before starting a face search.",
            )
        result = await run_social_search_and_verification_pipeline(
            face_input_b64=payload.image,
            search_query=payload.query or "",
            face_index=payload.face_index or 0,
            crop_region=payload.crop_region,
            threshold=payload.threshold or SFACE_L2_THRESHOLD,
        )
        return result
    except NoMatchFound as nm:
        # A genuine empty result, not a failure. 200 with match_found=False so
        # the UI can state it plainly and still show what was searched.
        d = nm.discovery or {}
        return {
            "success": True,
            "match_found": False,
            "pipeline_stage": "NO_MATCH",
            "message": str(nm),
            "diagnostics": {
                "search": {
                    "mechanisms": d.get("search_mechanisms", []),
                    "capabilities": d.get("capabilities", {}),
                    "candidates_considered": d.get("candidates_considered", 0),
                    "candidates_verified": d.get("candidates_verified", 0),
                    "threshold_l2": d.get("threshold_l2"),
                    "candidate_report": d.get("candidate_report", []),
                    "hint_report": d.get("hint_report", []),
                }
            },
        }
    except HTTPException:
        raise
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Pipeline error: {str(e)}")

class FeedbackRequest(BaseModel):
    """One operator judgement on a returned match."""
    label: str = Field(..., description=f"One of {VALID_LABELS}")
    euclidean_distance: float = Field(..., ge=0.0, le=2.0)
    cosine_similarity: Optional[float] = Field(None, ge=-1.0, le=1.0)
    threshold_used: Optional[float] = Field(None, ge=0.0, le=2.0)
    system_verdict: Optional[bool] = Field(
        None, description="What the pipeline decided, for agreement tracking.")
    page_url: Optional[str] = ""
    platform: Optional[str] = ""
    discovery_source: Optional[str] = ""
    media_sha256: Optional[str] = ""
    record_hash: Optional[str] = ""
    probe_embedding: Optional[list] = Field(
        None, description="The searching face, so a rejection applies only to it.")
    # Free-text justification. Stored verbatim and, when anchored, included in
    # the hashed record so the wording itself becomes tamper-evident.
    note: Optional[str] = Field("", max_length=2000,
                                description="Written review explaining the judgement.")
    commit_on_chain: Optional[bool] = Field(
        False, description="Anchor this review's SHA-256 on the blockchain.")


@router.post("/feedback")
def submit_feedback(payload: FeedbackRequest):
    """
    Record whether a returned match was actually right.

    These labels are the training set for threshold calibration. No image and
    no embedding is stored - only the distance, the label and provenance.
    """
    try:
        entry = record_feedback(
            label=payload.label,
            euclidean_distance=payload.euclidean_distance,
            cosine_similarity=payload.cosine_similarity,
            threshold_used=payload.threshold_used,
            system_verdict=payload.system_verdict,
            page_url=payload.page_url or "",
            platform=payload.platform or "",
            discovery_source=payload.discovery_source or "",
            media_sha256=payload.media_sha256 or "",
            record_hash=payload.record_hash or "",
            note=payload.note or "",
            commit_on_chain=bool(payload.commit_on_chain),
            probe_embedding=payload.probe_embedding,
        )
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))
    return {"success": True, "recorded": entry, "stats": feedback_stats()}


@router.get("/feedback/stats")
def feedback_statistics():
    """Label counts, agreement rate, and a data-driven threshold suggestion."""
    return {"stats": feedback_stats(), "calibration": suggest_threshold()}


class TeachRequest(BaseModel):
    """Teach the system an identity from a written review."""
    image: str = Field(..., description="Base64 face photo the claim is about")
    review: str = Field(..., min_length=1, max_length=2000,
                        description="Written review, e.g. 'this is the face of <profile url>'")
    name: Optional[str] = Field("", description="Identity name; inferred from the profile if blank")
    authorized_use: bool = Field(..., description="Caller confirms authorisation to enrol this face")


@router.post("/teach")
async def teach_endpoint(payload: TeachRequest):
    """
    Read the review, fetch what it cites, verify each face against the submitted
    photo, and enrol only what actually matches.

    A claim is not evidence - every supporting image passes the same biometric
    gate as a search result, and failures are returned with the reason.
    """
    if not payload.authorized_use:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Enrolling a face requires the authorisation acknowledgement.",
        )
    try:
        bgr = decode_base64_image(payload.image)
        return await teach_identity(bgr, payload.review, payload.name or "")
    except DivergentFace as df:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(df)) from df
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))


class EnrollRequest(BaseModel):
    """
    Enrol photographs of one person under a name.

    Used by the registration page (one capture) and by 1-to-1 verification
    (both photos of a confirmed pair). Multiple images per identity is the
    point: SFace scores a probe against the CLOSEST stored reference, so a
    face enrolled from several photos taken at different times keeps matching
    as it changes, which one reference photo does not.
    """
    images: List[str] = Field(..., min_length=1, max_length=10,
                              description="Base64 photos of the SAME person")
    name: str = Field(..., min_length=1, max_length=120)
    note: Optional[str] = Field("", max_length=2000)
    threshold: Optional[float] = Field(None, ge=0.20, le=1.60)
    authorized_use: bool = Field(..., description="Caller confirms authorisation to enrol this face")


@router.post("/gallery/enroll")
def gallery_enroll_endpoint(payload: EnrollRequest):
    """
    Enrol verified photos of one identity.

    Every image after the first is face-checked against the first before it is
    stored. Enrolling on the operator's word alone would let one mislabelled
    photo poison the identity permanently, and the system would then repeat
    that error confidently - so a mismatched image is rejected with its score
    rather than accepted.

    Enrolled photos are marked NOT web-reachable: they are local files, not
    discovered posts, so they can improve recognition but can never be
    presented as a search result.
    """
    if not payload.authorized_use:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Enrolling a face requires the authorisation acknowledgement.",
        )

    threshold = payload.threshold or SFACE_L2_THRESHOLD
    accepted: List[Dict[str, Any]] = []
    rejected: List[Dict[str, Any]] = []
    anchor: Optional[List[float]] = None

    for i, img_b64 in enumerate(payload.images):
        try:
            bgr = decode_base64_image(img_b64)
            face = embed_primary_face(bgr)
        except Exception as e:
            rejected.append({"index": i, "reason": f"no usable face ({e})"})
            continue

        emb = face["embedding"]
        if anchor is None:
            anchor = emb
            score = {"euclidean_distance": 0.0, "cosine_similarity": 1.0,
                     "similarity_percentage": 100.0, "note": "reference image"}
        else:
            is_match, pct, l2, cos = evaluate_face_similarity(anchor, emb, threshold=threshold)
            if not is_match:
                rejected.append({
                    "index": i,
                    "reason": (f"does not match the first image (L2 {l2:.4f} > {threshold}) "
                               "- enrolling it would corrupt this identity"),
                    "euclidean_distance": l2,
                    "cosine_similarity": cos,
                })
                continue
            score = {"euclidean_distance": l2, "cosine_similarity": cos,
                     "similarity_percentage": pct, "note": "verified against the reference"}

        accepted.append({
            "embedding": emb,
            "origin": f"enrolled photo #{i + 1}",
            "image_url": "",
            "platform": "operator",
            "media_sha256": "",
            "web_reachable": False,
            "thumbnail": encode_image_to_base64(
                cv2.resize(face["display_crop"], (96, 96))
            ),
            "_score": score,
        })

    if not accepted:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Nothing could be enrolled: " +
                   "; ".join(r["reason"] for r in rejected),
        )

    scores = [a.pop("_score") for a in accepted]
    try:
        identity = enroll(name=payload.name, embeddings=accepted, review=payload.note or "")
    except DivergentFace as df:
        # The name already belongs to someone whose face this is not.
        raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                            detail=str(df)) from df

    return {
        "success": True,
        "identity": identity["name"],
        "added_now": len(accepted),
        "total_references": len(identity["faces"]),
        "accepted": scores,
        "rejected": rejected,
        "threshold_used": threshold,
    }


@router.get("/gallery")
def gallery_endpoint():
    """Everything the system has been taught. Embeddings stripped."""
    return gallery_summary()


@router.delete("/gallery/{name}")
def gallery_delete(name: str):
    """Erase an enrolled identity. Biometric data must be removable on request."""
    if delete_identity(name):
        return {"success": True, "deleted": name, "gallery": gallery_summary()}
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                        detail=f"No enrolled identity named {name!r}")


class GalleryMatchRequest(BaseModel):
    image: str
    threshold: Optional[float] = Field(None, ge=0.20, le=1.60)


@router.post("/gallery/match")
def gallery_match_endpoint(payload: GalleryMatchRequest):
    """Check a photo against enrolled identities only - no web search."""
    try:
        bgr = decode_base64_image(payload.image)
        emb = embed_primary_face(bgr)["embedding"]
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))
    kwargs = {"threshold": payload.threshold} if payload.threshold else {}
    return match_gallery(emb, **kwargs)


@router.get("/capabilities")
def capabilities_endpoint():
    """Which models and which search mechanism are actually live right now."""
    return {"models": models_ready(), "search": search_capabilities()}


@router.post("/fetch")
async def fetch_post_endpoint(payload: FetchUrlRequest):
    """
    Fetches OpenGraph metadata, title, author, and base64 image from any social post or web URL.
    """
    try:
        post = await fetch_post_metadata_and_image(payload.url)
        if not post:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Unable to extract social media post image from {payload.url}. Ensure the link is public."
            )

        b64_img = encode_image_to_base64(post["image_bgr"])

        return {
            "success": True,
            "post_url": post["post_url"],
            "platform": post["platform"],
            "author": post["author"],
            "title": post["title"],
            "description": post["description"],
            "image_url": post["image_url"],
            "image_base64": b64_img
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))

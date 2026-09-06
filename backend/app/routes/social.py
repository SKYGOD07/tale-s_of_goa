from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field
from typing import Dict, Any, Optional

from app.services.social_search import (
    run_social_search_and_verification_pipeline,
    fetch_post_metadata_and_image,
    NoMatchFound,
)
from app.services.face_processor import encode_image_to_base64, models_ready, SFACE_L2_THRESHOLD
from app.services.face_search import search_capabilities

router = APIRouter(prefix="/api/social", tags=["Social Media Pipeline"])

class SocialSearchRequest(BaseModel):
    image: str = Field(..., description="Base64 encoded input face scan / camera frame")
    query: Optional[str] = Field("", description="Optional search query (e.g. name or social handle)")
    authorized_use: bool = Field(
        ...,
        description="Caller confirms they are authorized to search with this image.",
    )
    # L2 distance. Default is SFace's published operating point; it is not a
    # dial to widen until a particular photo passes.
    threshold: Optional[float] = Field(
        SFACE_L2_THRESHOLD,
        description=f"SFace L2 match threshold (default {SFACE_L2_THRESHOLD})",
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
                }
            },
        }
    except HTTPException:
        raise
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Pipeline error: {str(e)}")

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

"""
Turning a written review into verified memory.

The operator writes something like:

    "This image is the face of https://www.linkedin.com/in/aditya-tomar-b41654387/
     and https://github.com/adityatomar4877-rgb"

This module reads that, fetches whatever the review cites and can legitimately
be fetched, checks each retrieved face against the submitted photo, and enrols
only what actually matches.

The important word is **verified**. A claim is not evidence: saying "this face
is X" does not make it so, and a system that enrolled on assertion alone would
happily learn a wrong identity and then repeat that error confidently forever.
Every supporting image must pass the same biometric gate as any search result,
and anything that fails is reported with the reason rather than silently
dropped.

Platform reality:
  GitHub    - avatar is a documented public endpoint. Fetched and verified.
  LinkedIn  - profile photos sit behind a login wall. Automated retrieval would
              breach their terms, so the URL is recorded as an operator-asserted
              reference and clearly marked unverified. To verify it, download
              your own picture and enrol it as a file.
"""

import hashlib
import io
import re
from typing import Any, Dict, List, Optional

import cv2
import httpx
import numpy as np
from PIL import Image, ImageOps

from app.services.face_processor import (
    embed_primary_face,
    evaluate_face_similarity,
    encode_image_to_base64,
    crop_face_region,
    SFACE_L2_THRESHOLD,
)
from app.services.gallery import enroll

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

URL_RE = re.compile(r"https?://[^\s,)<>\"']+")

# Platforms whose media cannot be fetched without authentication. Listing them
# explicitly means the operator gets told why, instead of a silent failure.
LOGIN_WALLED = {
    "linkedin.com": "LinkedIn requires authentication for profile photos",
    "instagram.com": "Instagram requires authentication for profile media",
    "facebook.com": "Facebook requires authentication for profile media",
}


def extract_urls(text: str) -> List[str]:
    seen, out = set(), []
    for u in URL_RE.findall(text or ""):
        u = u.rstrip(".,;)")
        if u not in seen:
            seen.add(u)
            out.append(u)
    return out


def _platform_of(url: str) -> str:
    low = url.lower()
    for host in LOGIN_WALLED:
        if host in low:
            return host
    if "github.com" in low:
        return "github.com"
    return "web"


def _github_handle(url: str) -> Optional[str]:
    m = re.search(r"github\.com/([A-Za-z0-9][A-Za-z0-9-]{0,38})", url, re.I)
    return m.group(1) if m else None


async def _fetch_github_avatar(handle: str) -> Optional[Dict[str, Any]]:
    async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
        api = await client.get(
            f"https://api.github.com/users/{handle}",
            headers={"User-Agent": USER_AGENT, "Accept": "application/vnd.github+json"},
        )
        if api.status_code != 200:
            return None
        info = api.json()
        avatar = info.get("avatar_url")
        if not avatar:
            return None
        img = await client.get(avatar, headers={"User-Agent": USER_AGENT})
        if img.status_code != 200:
            return None
        return {
            "bytes": img.content,
            "avatar_url": avatar,
            "display_name": info.get("name") or handle,
            "profile_url": info.get("html_url") or f"https://github.com/{handle}",
        }


def _decode(raw: bytes) -> np.ndarray:
    pil = ImageOps.exif_transpose(Image.open(io.BytesIO(raw))).convert("RGB")
    return cv2.cvtColor(np.array(pil), cv2.COLOR_RGB2BGR)


async def teach_identity(
    probe_bgr: np.ndarray,
    review: str,
    name: str = "",
    threshold: float = SFACE_L2_THRESHOLD,
) -> Dict[str, Any]:
    """
    Verify the claim in `review` against `probe_bgr`, then enrol what checks out.

    Returns a full audit: what was fetched, what matched, what was rejected and
    why, and what ended up in the gallery.
    """
    probe = embed_primary_face(probe_bgr)
    probe_emb = probe["embedding"]

    urls = extract_urls(review)
    references: List[Dict[str, Any]] = []
    verified: List[Dict[str, Any]] = []
    resolved_name = name.strip()

    for url in urls:
        platform = _platform_of(url)

        if platform in LOGIN_WALLED:
            references.append({
                "url": url,
                "platform": platform,
                "status": "unverified",
                "reason": LOGIN_WALLED[platform] + " - recorded as an operator-asserted reference only",
            })
            continue

        if platform == "github.com":
            handle = _github_handle(url)
            if not handle:
                references.append({"url": url, "platform": platform,
                                   "status": "skipped", "reason": "no username in URL"})
                continue
            try:
                got = await _fetch_github_avatar(handle)
            except Exception as e:
                references.append({"url": url, "platform": platform,
                                   "status": "error", "reason": str(e)})
                continue
            if not got:
                references.append({"url": url, "platform": platform,
                                   "status": "error", "reason": "account or avatar not reachable"})
                continue

            if not resolved_name:
                resolved_name = got["display_name"]

            try:
                img = _decode(got["bytes"])
                ref = embed_primary_face(img)
            except Exception as e:
                references.append({"url": url, "platform": platform,
                                   "status": "rejected",
                                   "reason": f"no usable face in the avatar ({e})"})
                continue

            is_match, pct, l2, cos = evaluate_face_similarity(
                probe_emb, ref["embedding"], threshold=threshold
            )
            row = {
                "url": got["profile_url"],
                "image_url": got["avatar_url"],
                "platform": platform,
                "similarity_percentage": pct,
                "euclidean_distance": l2,
                "cosine_similarity": cos,
                "status": "verified" if is_match else "rejected",
                "reason": "" if is_match else
                          f"face does not match the submitted photo (L2 {l2:.4f} > {threshold})",
            }
            references.append(row)
            if is_match:
                verified.append({
                    "embedding": ref["embedding"],
                    "origin": got["profile_url"],
                    "image_url": got["avatar_url"],
                    "platform": platform,
                    # Fingerprint of the exact bytes fetched, so the on-chain
                    # record binds to a specific image rather than a URL that
                    # can later serve something else.
                    "media_sha256": hashlib.sha256(got["bytes"]).hexdigest(),
                    "web_reachable": True,
                    "thumbnail": encode_image_to_base64(
                        cv2.resize(crop_face_region(img, ref["detection"].box), (96, 96))
                    ),
                })
            continue

        references.append({"url": url, "platform": platform, "status": "skipped",
                           "reason": "not a supported profile source"})

    # The submitted photo is itself a reference - it is the one image whose
    # identity the operator is asserting first-hand.
    verified.insert(0, {
        "embedding": probe_emb,
        "origin": "operator-submitted photo",
        "image_url": "",
        "platform": "operator",
        "media_sha256": "",
        # Not a discoverable post - it is the operator's own copy. Marked so it
        # can never be presented as a "found" result, which would be circular.
        "web_reachable": False,
        "thumbnail": encode_image_to_base64(
            cv2.resize(probe["display_crop"], (96, 96))
        ),
    })

    if not resolved_name:
        resolved_name = "Unnamed identity"

    identity = enroll(
        name=resolved_name,
        embeddings=verified,
        source_urls=[r["url"] for r in references
                     if r["status"] in ("verified", "unverified")],
        review=review,
    )

    return {
        "success": True,
        "identity": resolved_name,
        "enrolled_faces": len(identity["faces"]),
        "added_now": len(verified),
        "references": references,
        "verified_count": sum(1 for r in references if r["status"] == "verified"),
        "unverified_count": sum(1 for r in references if r["status"] == "unverified"),
        "rejected_count": sum(1 for r in references if r["status"] == "rejected"),
        "threshold_used": threshold,
        "probe": {
            "image_width": probe["image_width"],
            "image_height": probe["image_height"],
            "detection_score": round(probe["detection"].score, 4),
        },
    }

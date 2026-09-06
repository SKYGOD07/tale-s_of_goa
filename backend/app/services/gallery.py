"""
Enrolled identity gallery — the part that actually remembers people.

Threshold calibration tunes *where the line is*. This is different: it stores
**who you have already told the system about**, so a later photo of the same
person is recognised directly instead of depending on whether a search engine
happens to have indexed them.

Why this is the right shape for "don't make the same mistake again":

  * A gallery holds MULTIPLE embeddings per identity. Faces move — age, beard,
    glasses, lighting, camera. One reference photo generalises badly; five
    taken over two years generalise well. A probe is compared against every
    stored embedding and scored on the CLOSEST one, so an older photo matches
    through whichever reference is nearest it in time and appearance.
  * It is checked BEFORE any web search. Offline, instant, and unaffected by
    whether the person is publicly indexed.
  * Enrolment is verified, not asserted. Claiming "this face is X" does not
    make it so; each supporting image is face-checked against the probe before
    it is stored, and images that fail are rejected with a reason.

Stored per identity: name, the source URLs the operator cited, and 128-D
embeddings. Face crops are kept only as small JPEG thumbnails for the UI. The
original photographs are NOT copied here.
"""

import json
import os
import threading
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import numpy as np

from app.services.face_processor import (
    evaluate_face_similarity,
    SFACE_L2_THRESHOLD,
)

_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "..", "data")
GALLERY_PATH = os.path.abspath(os.path.join(_DIR, "gallery.json"))

_LOCK = threading.Lock()


def _ensure_dir() -> None:
    os.makedirs(os.path.dirname(GALLERY_PATH), exist_ok=True)


def load_gallery() -> Dict[str, Any]:
    if not os.path.exists(GALLERY_PATH):
        return {"version": "1.0", "identities": []}
    try:
        with open(GALLERY_PATH, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        data.setdefault("identities", [])
        return data
    except (json.JSONDecodeError, OSError):
        return {"version": "1.0", "identities": []}


def save_gallery(data: Dict[str, Any]) -> None:
    _ensure_dir()
    with _LOCK:
        with open(GALLERY_PATH, "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False, indent=2)


def find_identity(gallery: Dict[str, Any], name: str) -> Optional[Dict[str, Any]]:
    key = name.strip().lower()
    for ident in gallery["identities"]:
        if ident["name"].strip().lower() == key:
            return ident
    return None


def enroll(
    name: str,
    embeddings: List[Dict[str, Any]],
    source_urls: Optional[List[str]] = None,
    review: str = "",
    notes: str = "",
) -> Dict[str, Any]:
    """
    Add or extend an identity.

    `embeddings` is a list of {embedding, origin, thumbnail?} - one per
    reference image. Re-enrolling the same name APPENDS, which is how the
    gallery gets better at older or otherwise different photos over time.
    """
    if not name.strip():
        raise ValueError("An identity needs a name")
    if not embeddings:
        raise ValueError("An identity needs at least one verified face")

    gallery = load_gallery()
    ident = find_identity(gallery, name)
    now = datetime.now(timezone.utc).isoformat()

    if ident is None:
        ident = {
            "name": name.strip(),
            "created_at": now,
            "updated_at": now,
            "source_urls": [],
            "reviews": [],
            "faces": [],
        }
        gallery["identities"].append(ident)

    ident["updated_at"] = now
    for u in (source_urls or []):
        if u and u not in ident["source_urls"]:
            ident["source_urls"].append(u)
    if review:
        ident["reviews"].append({"at": now, "text": review[:2000]})
    if notes:
        ident.setdefault("notes", []).append(notes[:500])

    for e in embeddings:
        ident["faces"].append({
            "added_at": now,
            "origin": e.get("origin", "unknown"),
            "image_url": e.get("image_url", ""),
            "platform": e.get("platform", ""),
            "media_sha256": e.get("media_sha256", ""),
            "web_reachable": bool(e.get("web_reachable", False)),
            "embedding": e["embedding"],
            "thumbnail": e.get("thumbnail", ""),
        })

    save_gallery(gallery)
    return ident


def match_gallery(
    embedding: List[float],
    threshold: float = SFACE_L2_THRESHOLD,
) -> Dict[str, Any]:
    """
    Compare a probe against every enrolled face.

    Scoring is nearest-reference: an identity is as close as its single best
    matching photo, not its average. Averaging would penalise an identity for
    holding a wide range of reference images, which is exactly the range that
    makes it robust.
    """
    gallery = load_gallery()
    scored: List[Dict[str, Any]] = []

    for ident in gallery["identities"]:
        best = None
        # One row per web-reachable reference. These are the only ones that can
        # be presented as a discovered profile: the operator's own photo would
        # be a self-match, scoring ~0 and proving nothing.
        profiles: List[Dict[str, Any]] = []

        for face in ident["faces"]:
            is_match, pct, l2, cos = evaluate_face_similarity(
                embedding, face["embedding"], threshold=threshold
            )
            if best is None or l2 < best["euclidean_distance"]:
                best = {
                    "is_match": is_match,
                    "similarity_percentage": pct,
                    "euclidean_distance": l2,
                    "cosine_similarity": cos,
                    "matched_origin": face.get("origin", "unknown"),
                    "thumbnail": face.get("thumbnail", ""),
                }
            if face.get("web_reachable"):
                profiles.append({
                    "url": face.get("origin", ""),
                    "image_url": face.get("image_url", ""),
                    "platform": face.get("platform", ""),
                    "media_sha256": face.get("media_sha256", ""),
                    "thumbnail": face.get("thumbnail", ""),
                    "is_match": is_match,
                    "similarity_percentage": pct,
                    "euclidean_distance": l2,
                    "cosine_similarity": cos,
                    "verified": True,
                })

        if best is None:
            continue

        # Collapse duplicates of the same profile, keeping its best score.
        by_url: Dict[str, Dict[str, Any]] = {}
        for pr in profiles:
            cur = by_url.get(pr["url"])
            if cur is None or pr["euclidean_distance"] < cur["euclidean_distance"]:
                by_url[pr["url"]] = pr
        profiles = sorted(by_url.values(), key=lambda r: r["euclidean_distance"])

        # URLs the operator asserted but which could not be fetched (login
        # walls). Listed so they are visible, flagged so they are not mistaken
        # for verified evidence.
        fetched = {pr["url"] for pr in profiles}
        asserted = [
            {"url": u, "platform": "", "verified": False,
             "reason": "not fetchable without authentication - operator-asserted"}
            for u in ident.get("source_urls", [])
            if u not in fetched
        ]

        scored.append({
            "name": ident["name"],
            "source_urls": ident.get("source_urls", []),
            "profiles": profiles,
            "asserted_profiles": asserted,
            "reference_count": len(ident["faces"]),
            "reviews": ident.get("reviews", []),
            **best,
        })

    scored.sort(key=lambda r: r["euclidean_distance"])
    passing = [r for r in scored if r["is_match"]]

    return {
        "match": passing[0] if passing else None,
        "all_scored": scored[:10],
        "enrolled_identities": len(gallery["identities"]),
        "enrolled_faces": sum(len(i["faces"]) for i in gallery["identities"]),
        "threshold_used": threshold,
    }


def gallery_summary() -> Dict[str, Any]:
    """Listing for the UI - embeddings stripped, thumbnails kept."""
    gallery = load_gallery()
    return {
        "identities": [
            {
                "name": i["name"],
                "source_urls": i.get("source_urls", []),
                "reference_count": len(i["faces"]),
                "created_at": i.get("created_at"),
                "updated_at": i.get("updated_at"),
                "reviews": i.get("reviews", []),
                "origins": [f.get("origin", "unknown") for f in i["faces"]],
                "thumbnails": [f.get("thumbnail", "") for f in i["faces"] if f.get("thumbnail")][:6],
            }
            for i in gallery["identities"]
        ],
        "total_identities": len(gallery["identities"]),
        "total_faces": sum(len(i["faces"]) for i in gallery["identities"]),
        "path": GALLERY_PATH,
    }


def delete_identity(name: str) -> bool:
    """Remove an identity entirely. Biometric data must be erasable on request."""
    gallery = load_gallery()
    before = len(gallery["identities"])
    key = name.strip().lower()
    gallery["identities"] = [
        i for i in gallery["identities"] if i["name"].strip().lower() != key
    ]
    if len(gallery["identities"]) != before:
        save_gallery(gallery)
        return True
    return False

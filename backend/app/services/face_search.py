"""
Genuine face-driven web/social discovery.

The rule this module exists to enforce: a result is only ever returned when a
face in a page that was found by a LIVE search actually matches the input face.
There is no candidate list in this file. Nothing is pre-picked. If the search
returns nothing, or nothing passes the biometric threshold, the answer is "no
match found" - never a substitute identity.

Two discovery layers, in order of strength:

  1. Reverse image search (true face -> web). Sends the actual face image to a
     visual-search provider and gets back pages that contain that image. This
     is the only mechanism that can identify an unknown person from a photo
     alone. Requires an API key, so it is optional.

  2. Live scripted search (text-seeded, face-gated). Queries live web/social
     indices, then downloads every candidate image, detects and embeds every
     face in it, and keeps a candidate only if it passes the SFace threshold.
     No key needed. Honest about what it is: discovery is seeded by a text
     hint, and the face check is what decides the outcome.

Either way the verification stage is identical and mandatory.
"""

import io
import os
import hashlib
import urllib.parse
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

import cv2
import httpx
import numpy as np
from bs4 import BeautifulSoup
from PIL import Image, ImageOps

from app.services.face_processor import (
    detect_faces_detailed,
    encode_face,
    feature_to_list,
    evaluate_face_similarity,
    crop_face_region,
    encode_image_to_base64,
    SFACE_L2_THRESHOLD,
)

from dotenv import load_dotenv

load_dotenv()

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

def get_reverse_provider() -> str:
    return os.getenv("REVERSE_IMAGE_PROVIDER", "").strip().lower()

def get_serpapi_key() -> str:
    return os.getenv("SERPAPI_KEY", "").strip()

def get_bing_key() -> str:
    return os.getenv("BING_VISUAL_SEARCH_KEY", "").strip()

MAX_CANDIDATES = 12
MAX_FACES_PER_CANDIDATE = 6


@dataclass
class Candidate:
    """A page found by a live search, before any face check has been applied."""
    page_url: str
    image_url: str
    title: str = ""
    description: str = ""
    author: str = ""
    platform: str = ""
    source: str = ""          # which live mechanism produced it
    # Filled in by verification.
    faces_found: int = 0
    best_cosine: Optional[float] = None
    best_l2: Optional[float] = None
    similarity_pct: Optional[float] = None
    is_match: bool = False
    image_bgr: Optional[np.ndarray] = None
    image_bytes: Optional[bytes] = None
    media_sha256: str = ""
    face_crop_b64: str = ""
    error: str = ""

    def to_report(self) -> Dict[str, Any]:
        """Serialisable audit row - shown in the UI so every candidate is visible."""
        return {
            "page_url": self.page_url,
            "image_url": self.image_url,
            "title": self.title,
            "author": self.author,
            "platform": self.platform,
            "source": self.source,
            "faces_found": self.faces_found,
            "cosine_similarity": self.best_cosine,
            "euclidean_distance": self.best_l2,
            "similarity_percentage": self.similarity_pct,
            "is_match": self.is_match,
            "media_sha256": self.media_sha256 or None,
            "error": self.error or None,
        }


def detect_platform(url: str) -> str:
    host = urllib.parse.urlparse(url).netloc.lower()
    for needle, name in (
        ("github.com", "GitHub"), ("twitter.com", "Twitter/X"), ("x.com", "Twitter/X"),
        ("reddit.com", "Reddit"), ("instagram.com", "Instagram"),
        ("linkedin.com", "LinkedIn"), ("facebook.com", "Facebook"),
        ("wikipedia.org", "Wikipedia"), ("wikimedia.org", "Wikimedia"),
        ("mastodon", "Mastodon"), ("youtube.com", "YouTube"),
    ):
        if needle in host:
            return name
    return host or "Web"


def search_capabilities() -> Dict[str, Any]:
    """Reported to the UI so it can state which discovery layer is actually live."""
    try:
        import ddgs  # noqa: F401
        live_ok = True
    except ImportError:
        live_ok = False

    rev_prov = get_reverse_provider()
    serp_key = get_serpapi_key()
    bing_key = get_bing_key()

    provider = None
    if rev_prov == "serpapi" and serp_key:
        provider = "SerpAPI (Google Lens)"
    elif rev_prov == "bing" and bing_key:
        provider = "Bing Visual Search"

    return {
        "reverse_image_search": provider,
        "reverse_image_available": provider is not None,
        "live_search_available": live_ok,
        "live_search_engine": "DuckDuckGo (ddgs)" if live_ok else None,
        "mode": (
            "reverse_image" if provider
            else "live_scripted" if live_ok
            else "unavailable"
        ),
    }


# ─────────────────────────────────────────────────────────────────────────
# Candidate gathering — every source here hits the live network
# ─────────────────────────────────────────────────────────────────────────

async def _reverse_image_candidates(image_bytes: bytes) -> List[Candidate]:
    """True face->web discovery. Only runs when a provider key is configured."""
    caps = search_capabilities()
    if not caps["reverse_image_available"]:
        return []

    rev_prov = get_reverse_provider()
    bing_key = get_bing_key()

    out: List[Candidate] = []
    try:
        if rev_prov == "bing":
            # Bing Visual Search accepts the image binary directly, so it works
            # on a local photo with no public URL - the right fit here.
            async with httpx.AsyncClient(timeout=20.0) as client:
                resp = await client.post(
                    "https://api.bing.microsoft.com/v7.0/images/visualsearch",
                    headers={"Ocp-Apim-Subscription-Key": bing_key},
                    files={"image": ("face.jpg", image_bytes, "image/jpeg")},
                )
                resp.raise_for_status()
                for tag in resp.json().get("tags", []):
                    for action in tag.get("actions", []):
                        for item in (action.get("data", {}) or {}).get("value", []):
                            page = item.get("hostPageUrl")
                            img = item.get("contentUrl")
                            if page and img:
                                out.append(Candidate(
                                    page_url=page, image_url=img,
                                    title=item.get("name", ""),
                                    platform=detect_platform(page),
                                    source="reverse_image:bing",
                                ))
        elif rev_prov == "serpapi":
            # Google Lens via SerpAPI needs a publicly reachable image URL, so it
            # cannot be handed a local photo. Left wired for deployments that
            # host the scan somewhere fetchable.
            print("[Face Search] SerpAPI Google Lens requires a public image URL; "
                  "skipping for a locally supplied scan.")
    except Exception as e:
        print(f"[Face Search] Reverse image search failed: {e}")

    return out[:MAX_CANDIDATES]


async def _live_search_candidates(query: str) -> List[Candidate]:
    """Live text + image search. Candidates come from the network, never a list."""
    query = query.strip()
    if not query:
        return []

    out: List[Candidate] = []
    try:
        from ddgs import DDGS
    except ImportError:
        print("[Face Search] ddgs is not installed; live search unavailable.")
        return []

    # Image search first: results already point at an image containing a face.
    try:
        with DDGS(timeout=10) as ddgs:
            for r in ddgs.images(query, max_results=MAX_CANDIDATES):
                img = r.get("image")
                page = r.get("url") or r.get("source") or img
                if img and page:
                    out.append(Candidate(
                        page_url=page, image_url=img,
                        title=(r.get("title") or "")[:140],
                        platform=detect_platform(page),
                        source="live:ddg_images",
                    ))
    except Exception as e:
        print(f"[Face Search] DDG image search notice: {e}")

    # Then social/profile pages, taking the OpenGraph image off each.
    try:
        with DDGS(timeout=10) as ddgs:
            social = f"{query} (site:github.com OR site:x.com OR site:reddit.com OR site:wikipedia.org)"
            for r in ddgs.text(social, max_results=6):
                href = r.get("href") or r.get("link")
                if not href:
                    continue
                og = await _opengraph_image(href)
                if og:
                    out.append(Candidate(
                        page_url=href, image_url=og,
                        title=(r.get("title") or "")[:140],
                        description=(r.get("body") or "")[:240],
                        platform=detect_platform(href),
                        source="live:ddg_text+opengraph",
                    ))
    except Exception as e:
        print(f"[Face Search] DDG text search notice: {e}")

    # De-duplicate on image URL, preserving order.
    seen, unique = set(), []
    for c in out:
        if c.image_url not in seen:
            seen.add(c.image_url)
            unique.append(c)
    return unique[:MAX_CANDIDATES]


async def _opengraph_image(page_url: str) -> Optional[str]:
    try:
        async with httpx.AsyncClient(timeout=8.0, follow_redirects=True) as client:
            resp = await client.get(page_url, headers={"User-Agent": USER_AGENT})
            if resp.status_code != 200:
                return None
            soup = BeautifulSoup(resp.text, "html.parser")
            for attrs in ({"property": "og:image"}, {"name": "twitter:image"}):
                tag = soup.find("meta", attrs=attrs)
                if tag and tag.get("content"):
                    return urllib.parse.urljoin(page_url, tag["content"])
    except Exception:
        return None
    return None


async def _download_image(url: str) -> Optional[tuple]:
    try:
        async with httpx.AsyncClient(timeout=12.0, follow_redirects=True) as client:
            resp = await client.get(url, headers={"User-Agent": USER_AGENT})
            if resp.status_code != 200 or len(resp.content) < 400:
                return None
            pil = ImageOps.exif_transpose(Image.open(io.BytesIO(resp.content))).convert("RGB")
            return resp.content, cv2.cvtColor(np.array(pil), cv2.COLOR_RGB2BGR)
    except Exception:
        return None


# ─────────────────────────────────────────────────────────────────────────
# Verification — the stage that decides the outcome
# ─────────────────────────────────────────────────────────────────────────

async def verify_candidate(candidate: Candidate, scan_embedding: List[float],
                           l2_threshold: float) -> Candidate:
    """
    Downloads the candidate image, embeds EVERY face in it, and keeps the best
    score against the input face. A candidate with no detectable face is
    rejected outright - it cannot corroborate an identity.
    """
    downloaded = await _download_image(candidate.image_url)
    if not downloaded:
        candidate.error = "image could not be downloaded or decoded"
        return candidate

    candidate.image_bytes, candidate.image_bgr = downloaded
    # Fingerprint the exact public media bytes that were verified. The image
    # itself remains off-chain; only this digest enters the canonical record.
    candidate.media_sha256 = hashlib.sha256(candidate.image_bytes).hexdigest()

    try:
        detections, _, _ = detect_faces_detailed(candidate.image_bgr)
    except Exception as e:
        candidate.error = f"detection failed: {e}"
        return candidate

    candidate.faces_found = len(detections)
    if not detections:
        candidate.error = "no face in candidate image"
        return candidate

    best = None
    for det in detections[:MAX_FACES_PER_CANDIDATE]:
        try:
            _, feature = encode_face(candidate.image_bgr, det)
        except Exception:
            continue
        is_match, sim_pct, l2, cosine = evaluate_face_similarity(
            scan_embedding, feature_to_list(feature), threshold=l2_threshold
        )
        if best is None or l2 < best[2]:
            best = (is_match, sim_pct, l2, cosine, det)

    if best is None:
        candidate.error = "no face could be embedded"
        return candidate

    is_match, sim_pct, l2, cosine, det = best
    candidate.is_match = is_match
    candidate.similarity_pct = sim_pct
    candidate.best_l2 = l2
    candidate.best_cosine = cosine
    candidate.face_crop_b64 = encode_image_to_base64(
        crop_face_region(candidate.image_bgr, det.box)
    )
    return candidate


async def discover_matching_post(
    scan_embedding: List[float],
    scan_image_bytes: Optional[bytes] = None,
    query: str = "",
    l2_threshold: float = SFACE_L2_THRESHOLD,
) -> Dict[str, Any]:
    """
    Runs discovery and returns an audit of everything considered.

    `match` is None unless a candidate genuinely passed the biometric check.
    The caller must surface "no match found" in that case, never a stand-in.
    """
    caps = search_capabilities()
    candidates: List[Candidate] = []
    mechanisms: List[str] = []

    if caps["reverse_image_available"] and scan_image_bytes:
        mechanisms.append(caps["reverse_image_search"])
        candidates.extend(await _reverse_image_candidates(scan_image_bytes))

    if not candidates and query:
        if caps["live_search_available"]:
            mechanisms.append(f"{caps['live_search_engine']} (text-seeded, face-gated)")
            candidates.extend(await _live_search_candidates(query))

    note = ""
    if not candidates:
        if not caps["reverse_image_available"] and not query:
            note = (
                "No reverse-image provider is configured, so a face alone cannot be "
                "searched against the web. Set REVERSE_IMAGE_PROVIDER + an API key "
                "for true face-driven discovery, or supply a search hint to use the "
                "live face-gated search."
            )
        elif not caps["live_search_available"]:
            note = "Live search is unavailable: the 'ddgs' package is not installed."
        else:
            note = "The live search returned no candidate pages containing images."

    print(f"\n[Face Search] mechanisms={mechanisms or ['none']} candidates={len(candidates)} "
          f"threshold(L2)<={l2_threshold}")

    verified: List[Candidate] = []
    for cand in candidates:
        result = await verify_candidate(cand, scan_embedding, l2_threshold)
        verified.append(result)
        if result.error:
            print(f"  [reject] {result.image_url[:70]:<70} {result.error}")
        else:
            print(f"  [check ] {result.image_url[:70]:<70} "
                  f"faces={result.faces_found} cos={result.best_cosine:+.4f} "
                  f"L2={result.best_l2:.4f} -> {'MATCH' if result.is_match else 'no'}")

    passing = [c for c in verified if c.is_match and c.best_l2 is not None]
    passing.sort(key=lambda c: c.best_l2)
    best_match = passing[0] if passing else None

    scored = [c for c in verified if c.best_l2 is not None]
    scored.sort(key=lambda c: c.best_l2)

    if best_match:
        print(f"  [MATCH ] {best_match.author or best_match.page_url} "
              f"L2={best_match.best_l2:.4f}")
    else:
        closest = f"{scored[0].best_l2:.4f}" if scored else "n/a"
        print(f"  [NO MATCH] nothing passed the threshold (closest L2={closest})")

    return {
        "match": best_match,
        "candidates_considered": len(candidates),
        "candidates_verified": len(scored),
        "search_mechanisms": mechanisms,
        "capabilities": caps,
        "threshold_l2": l2_threshold,
        "note": note,
        "candidate_report": [c.to_report() for c in scored[:MAX_CANDIDATES]],
    }

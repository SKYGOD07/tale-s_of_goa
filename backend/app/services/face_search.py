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
import re
import hashlib
import urllib.parse
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

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

def get_serper_key() -> str:
    return os.getenv("SERPER_API_KEY", "").strip()

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

    serper_key = get_serper_key()

    provider = None
    if rev_prov == "serper" and serper_key:
        provider = "Serper.dev (Google Lens)"
    elif rev_prov == "serpapi" and serp_key:
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

# Reverse-image providers cap the upload they accept (SerpAPI rejects large
# posts with a bare 400). A full-resolution phone photo is routinely 1-3 MB, so
# the probe is cropped to the face plus surrounding context and compressed
# under the cap before it is sent. Cropping also helps accuracy: Google Lens
# matches on the dominant subject, and a tight-ish portrait keeps the face
# dominant instead of the background.
REVERSE_PROBE_MAX_BYTES = 460_000
REVERSE_PROBE_MAX_EDGE = 1024
REVERSE_PROBE_CONTEXT = 0.6   # padding around the face box, as a fraction


def prepare_probe_image(image_bytes: bytes) -> bytes:
    """Face-centred, size-capped JPEG suitable for a reverse-image upload."""
    try:
        pil = ImageOps.exif_transpose(Image.open(io.BytesIO(image_bytes))).convert("RGB")
        bgr = cv2.cvtColor(np.array(pil), cv2.COLOR_RGB2BGR)

        # Crop to the largest face with generous context, when one is found.
        try:
            dets, _, _ = detect_faces_detailed(bgr)
        except Exception:
            dets = []
        if dets:
            box = dets[0].box
            fw = box["right"] - box["left"]
            fh = box["bottom"] - box["top"]
            px, py = int(fw * REVERSE_PROBE_CONTEXT), int(fh * REVERSE_PROBE_CONTEXT)
            h, w = bgr.shape[:2]
            bgr = bgr[max(0, box["top"] - py):min(h, box["bottom"] + py),
                      max(0, box["left"] - px):min(w, box["right"] + px)]

        # Cap the long edge, then step quality down until it fits.
        h, w = bgr.shape[:2]
        scale = min(1.0, REVERSE_PROBE_MAX_EDGE / max(h, w))
        if scale < 1.0:
            bgr = cv2.resize(bgr, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)

        for quality in (90, 80, 70, 60, 50, 40):
            ok, buf = cv2.imencode(".jpg", bgr, [cv2.IMWRITE_JPEG_QUALITY, quality])
            if ok and len(buf) <= REVERSE_PROBE_MAX_BYTES:
                return buf.tobytes()
        return buf.tobytes() if ok else image_bytes
    except Exception as e:
        print(f"[Face Search] probe preprocessing failed, sending original: {e}")
        return image_bytes


async def _reverse_image_candidates(image_bytes: bytes) -> List[Candidate]:
    """True face->web discovery. Only runs when a provider key is configured."""
    caps = search_capabilities()
    if not caps["reverse_image_available"]:
        return []

    rev_prov = get_reverse_provider()
    bing_key = get_bing_key()
    serp_key_local = get_serpapi_key()

    probe = prepare_probe_image(image_bytes)
    print(f"[Face Search] reverse-image probe: {len(image_bytes)/1024:.0f} KB "
          f"-> {len(probe)/1024:.0f} KB")

    out: List[Candidate] = []
    try:
        if rev_prov == "bing":
            # Bing Visual Search accepts the image binary directly, so it works
            # on a local photo with no public URL - the right fit here.
            async with httpx.AsyncClient(timeout=20.0) as client:
                resp = await client.post(
                    "https://api.bing.microsoft.com/v7.0/images/visualsearch",
                    headers={"Ocp-Apim-Subscription-Key": bing_key},
                    files={"image": ("face.jpg", probe, "image/jpeg")},
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
        elif rev_prov == "serper":
            # Serper.dev fronts Google Lens and takes the image inline as a
            # base64 data URI, so a local photo works with no hosting step.
            # Free tier is generous, which makes this the practical default.
            import base64 as _b64
            payload = {"image": "data:image/jpeg;base64," + _b64.b64encode(probe).decode()}
            async with httpx.AsyncClient(timeout=45.0) as client:
                resp = await client.post(
                    "https://google.serper.dev/lens",
                    headers={"X-API-KEY": get_serper_key(),
                             "Content-Type": "application/json"},
                    json=payload,
                )
                resp.raise_for_status()
                data = resp.json()
            # Lens returns matches under either key depending on the query.
            for key in ("organic", "visualMatches"):
                for item in data.get(key, []) or []:
                    page = item.get("link")
                    img = item.get("imageUrl") or item.get("thumbnail")
                    if page and img:
                        out.append(Candidate(
                            page_url=page, image_url=img,
                            title=(item.get("title") or "")[:140],
                            platform=detect_platform(page),
                            source="reverse_image:serper",
                        ))

        elif rev_prov == "serpapi":
            # SerpAPI's Lens engine needs the image to be reachable by URL, but
            # its own /image endpoint accepts an upload and hands back an
            # image_id that the search accepts - so a local photo works after a
            # two-step call rather than needing to be publicly hosted.
            async with httpx.AsyncClient(timeout=45.0) as client:
                up = await client.post(
                    "https://serpapi.com/image",
                    files={"image": ("query.jpg", probe, "image/jpeg")},
                    data={"api_key": serp_key_local},
                )
                up.raise_for_status()
                image_id = up.json().get("image_id")
                if not image_id:
                    raise RuntimeError("SerpAPI upload returned no image_id")

                sr = await client.get(
                    "https://serpapi.com/search.json",
                    params={"engine": "google_lens", "image_id": image_id,
                            "api_key": serp_key_local, "hl": "en", "country": "us"},
                )
                sr.raise_for_status()
                data = sr.json()

            for key in ("visual_matches", "exact_matches", "text_results"):
                for item in data.get(key, []) or []:
                    page = item.get("link")
                    img = item.get("original") or item.get("thumbnail")
                    if page and img:
                        out.append(Candidate(
                            page_url=page, image_url=img,
                            title=(item.get("title") or "")[:140],
                            platform=detect_platform(page),
                            source=f"reverse_image:serpapi:{key}",
                        ))
    except Exception as e:
        print(f"[Face Search] Reverse image search failed: {e}")

    return out[:MAX_CANDIDATES]


# ─────────────────────────────────────────────────────────────────────────
# Direct profile avatars
#
# Reverse image search can only surface photos a crawler has already indexed,
# which is why an ordinary person returns nothing. A profile avatar is
# different: it sits at a predictable public URL, so given a handle it can be
# fetched directly and face-checked like any other candidate. That covers the
# common "is this my GitHub picture?" case without any index at all.
#
# GitHub exposes https://github.com/<user>.png as a documented public avatar.
# LinkedIn, Instagram and Facebook are deliberately NOT attempted: their
# profile media sits behind a login wall and scraping it would breach their
# terms. If those are wanted, the account owner can download their own picture
# and use 1-to-1 verification instead.
# ─────────────────────────────────────────────────────────────────────────

_HANDLE_RE = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$")


def _extract_github_handle(query: str) -> Optional[str]:
    """Pull a GitHub username out of a handle, @handle or profile URL."""
    q = query.strip()
    if not q:
        return None
    m = re.search(r"github\.com/([A-Za-z0-9][A-Za-z0-9-]{0,38})", q, re.I)
    if m:
        return m.group(1)
    q = q.lstrip("@")
    # Bare single token that looks like a username (not a person's full name).
    if " " not in q and _HANDLE_RE.match(q):
        return q
    return None


async def _profile_avatar_candidates(query: str) -> List[Candidate]:
    """Fetch a public profile avatar for a handle, if one resolves."""
    handle = _extract_github_handle(query)
    if not handle:
        return []

    out: List[Candidate] = []
    try:
        async with httpx.AsyncClient(timeout=12.0, follow_redirects=True) as client:
            # Confirm the account exists before trusting the avatar URL.
            api = await client.get(
                f"https://api.github.com/users/{handle}",
                headers={"User-Agent": USER_AGENT, "Accept": "application/vnd.github+json"},
            )
            if api.status_code != 200:
                return []
            info = api.json()
            avatar = info.get("avatar_url")
            if not avatar:
                return []
            out.append(Candidate(
                page_url=info.get("html_url") or f"https://github.com/{handle}",
                image_url=avatar,
                title=(info.get("name") or handle)[:140],
                description=(info.get("bio") or "")[:240],
                author=handle,
                platform="GitHub",
                source="direct:github_avatar",
            ))
    except Exception as e:
        print(f"[Face Search] GitHub avatar lookup failed for {handle!r}: {e}")
    return out


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


# Hosts that refuse anonymous retrieval. Naming them means the operator is told
# WHY a URL they pasted contributed nothing, instead of it being quietly turned
# into a text query. Verified against the live sites:
#   linkedin.com/in/...    -> HTTP 999 authwall, no og:image at all
#   media.licdn.com/...    -> HTTP 403 on the image itself, with any headers
# A LinkedIn *post* page does serve og:image metadata, but the image it points
# at is on media.licdn.com and is blocked, so nothing usable comes back either.
_BLOCKED_HINT_HOSTS = {
    "linkedin.com": "LinkedIn blocks anonymous requests (HTTP 999 on profiles, "
                    "HTTP 403 on media.licdn.com images)",
    "instagram.com": "Instagram requires authentication for profile media",
    "facebook.com": "Facebook requires authentication for profile media",
}


def _classify_hint_url(url: str) -> Optional[str]:
    """The reason this URL cannot be fetched, or None if it can be tried."""
    low = url.lower()
    for host, reason in _BLOCKED_HINT_HOSTS.items():
        if host in low:
            return reason
    return None


async def _cited_url_candidates(query: str) -> Tuple[List[Candidate], List[Dict[str, str]]]:
    """
    Fetch any URL the operator pasted into the hint.

    A pasted URL is a direct instruction - "look at this page" - and treating it
    as a bag of search words instead is how a hint citing a LinkedIn profile
    ended up searching for a famous rapper who shares part of the slug. Fetch
    what can be fetched; report the rest rather than silently degrading it.
    """
    urls = re.findall(r"https?://[^\s,)<>\"']+", query or "")
    out: List[Candidate] = []
    report: List[Dict[str, str]] = []

    for raw in urls:
        url = raw.rstrip(".,;)")

        blocked = _classify_hint_url(url)
        if blocked:
            report.append({"url": url, "status": "blocked", "detail": blocked})
            continue

        try:
            og = await _opengraph_image(url)
        except Exception as e:
            report.append({"url": url, "status": "error", "detail": str(e)})
            continue

        if not og:
            report.append({"url": url, "status": "no_image",
                           "detail": "page fetched, but it exposes no og:image or twitter:image"})
            continue

        report.append({"url": url, "status": "fetched", "detail": og})
        out.append(Candidate(
            page_url=url, image_url=og,
            title="Page cited in the search hint",
            platform=detect_platform(url),
            source="direct:hint_url",
        ))

    return out, report


def _text_from_hint(query: str) -> str:
    """
    The part of a hint worth sending to a text search engine.

    URLs are stripped: a search engine matches on the readable fragments of a
    slug, which is how "linkedin.com/in/rza-mohammed-072859332" retrieved the
    Wu-Tang rapper. When a profile URL yields a name, that name is searched
    instead, which is what the operator meant.
    """
    from app.services.naming import name_from_profile_url

    urls = re.findall(r"https?://[^\s,)<>\"']+", query or "")
    text = re.sub(r"https?://\S+", " ", query or "")
    text = re.sub(r"[()\[\]]", " ", text)
    text = " ".join(text.split()).strip(" .,:;-")

    for u in urls:
        name = name_from_profile_url(u)
        if name and name.lower() not in text.lower():
            text = f"{text} {name}".strip()

    return text


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

    # Every configured source is queried and the results merged. Running the
    # hint search only when reverse-image found nothing meant a typed hint was
    # silently discarded whenever Lens returned anything at all - even when the
    # Lens results were useless. More candidates can only help: each one still
    # has to pass the same biometric gate.
    if caps["reverse_image_available"] and scan_image_bytes:
        mechanisms.append(caps["reverse_image_search"])
        candidates.extend(await _reverse_image_candidates(scan_image_bytes))

    hint_report: List[Dict[str, str]] = []
    if query:
        # A handle or profile URL resolves to that platform's avatar directly.
        direct = await _profile_avatar_candidates(query)
        if direct:
            mechanisms.append("Direct profile avatar")
            candidates.extend(direct)

        # Any other URL in the hint is fetched on its own merits.
        cited, hint_report = await _cited_url_candidates(query)
        if cited:
            mechanisms.append("Page cited in the hint")
            candidates.extend(cited)

        text_query = _text_from_hint(query)
        if caps["live_search_available"] and text_query:
            mechanisms.append(f"{caps['live_search_engine']} (text-seeded, face-gated)")
            candidates.extend(await _live_search_candidates(text_query))

    # De-duplicate on image URL, keeping first-seen order.
    seen_urls, merged = set(), []
    for c in candidates:
        if c.image_url not in seen_urls:
            seen_urls.add(c.image_url)
            merged.append(c)
    candidates = merged

    # Drop anything the operator has already rejected for THIS face, so a
    # result dismissed as "not them" stops coming back on every re-run.
    from app.services.feedback import suppressed_media
    blocked = suppressed_media(scan_embedding, threshold=l2_threshold)
    suppressed_count = 0
    if blocked:
        kept = []
        for c in candidates:
            if c.page_url in blocked:
                suppressed_count += 1
                continue
            kept.append(c)
        candidates = kept
        if suppressed_count:
            print(f"[Face Search] suppressed {suppressed_count} previously-rejected result(s)")

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

    if blocked:
        before = len(verified)
        verified = [c for c in verified if (c.media_sha256 or "") not in blocked]
        suppressed_count += before - len(verified)

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
        # Every candidate that passed the biometric gate, best first. A face
        # search legitimately returns several photos of the same person across
        # different pages, and showing only the single best one hides most of
        # the evidence. Each entry carries its own score and source URL.
        "matches": passing,
        "candidates_considered": len(candidates),
        "suppressed_previously_rejected": suppressed_count,
        "candidates_verified": len(scored),
        "search_mechanisms": mechanisms,
        "capabilities": caps,
        "threshold_l2": l2_threshold,
        "note": note,
        "hint_report": hint_report,
        "candidate_report": [c.to_report() for c in scored[:MAX_CANDIDATES]],
    }

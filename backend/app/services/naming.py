"""
Working out WHO a written review is talking about.

The operator types things like:

    "He is Aditya Tiwari (https://www.linkedin.com/in/aditya-tiwari-3715a6338/)"
    "he is rza mohammed"
    "This image is related to the face of https://github.com/someone"

Previously only a verified GitHub profile could supply a name, so any review
citing LinkedIn - which cannot be fetched - produced "Unnamed identity". That
was not merely cosmetic: every unnamed subject then merged into one gallery
record under that same literal string, mixing unrelated people into a single
identity that would go on to match almost anybody.

So a name is resolved from, in order of authority:

  1. an explicit name the operator supplied in the form field
  2. a name STATED in the review - the operator's own label for the subject
  3. the display name on a profile whose face was verified
  4. the slug of a cited profile URL, which is a weak but usually correct guess

A name is a label, not evidence. Nothing here decides whether two faces match;
that stays with the biometric check.
"""

import re
from typing import List, Optional

# Up to four words after the copula. Allows lowercase, because operators type
# "he is rza mohammed" as often as they type a capitalised name.
_NAME_CHARS = r"[A-Za-z][A-Za-z.'’-]*"
_NAME_PHRASE = rf"{_NAME_CHARS}(?:\s+{_NAME_CHARS}){{0,3}}"

_STATEMENT_PATTERNS = [
    rf"\b(?:he|she|they|this|that|it)\s+is\s+(?:the\s+)?({_NAME_PHRASE})",
    rf"\b(?:his|her|their|the)\s+name\s+is\s+({_NAME_PHRASE})",
    rf"\b(?:face|photo|picture|image)\s+(?:is\s+)?of\s+({_NAME_PHRASE})",
    rf"\bthis\s+is\s+({_NAME_PHRASE})",
]

# Words that show up right after "he is" but are never the start of a name.
_LEADING_NOISE = {
    "a", "an", "the", "not", "correct", "incorrect", "right", "wrong", "same",
    "different", "actually", "really", "definitely", "probably", "related",
    "from", "in", "on", "at", "my", "your", "our", "his", "her", "their",
    "this", "that", "it", "him", "them", "person", "guy", "man", "woman",
    "someone", "somebody", "yes", "no", "yep", "nope", "sure", "also", "still",
}

# LinkedIn appends a numeric-ish id to the vanity slug: aditya-tiwari-3715a6338
_ID_TOKEN = re.compile(r"\d")


def _clean(phrase: str) -> Optional[str]:
    """Trim filler off a captured phrase and title-case what remains."""
    words = [w for w in re.split(r"\s+", phrase.strip()) if w]

    while words and words[0].lower() in _LEADING_NOISE:
        words.pop(0)
    while words and words[-1].lower() in _LEADING_NOISE:
        words.pop()

    if not words:
        return None
    # A single common word ("correct", "him") is a sentence fragment, not a name.
    if len(words) == 1 and len(words[0]) < 3:
        return None

    name = " ".join(w.capitalize() if w.islower() else w for w in words)
    return name[:120]


def name_from_review(text: str) -> Optional[str]:
    """A name the operator stated outright, if there is one."""
    if not text:
        return None
    # URLs contain words like "activity" and "posts" that the patterns would
    # otherwise capture, so take them out before matching.
    stripped = re.sub(r"https?://\S+", " ", text)

    for pat in _STATEMENT_PATTERNS:
        m = re.search(pat, stripped, re.I)
        if m:
            cleaned = _clean(m.group(1))
            if cleaned:
                return cleaned
    return None


def name_from_profile_url(url: str) -> Optional[str]:
    """
    Guess a name from a profile slug.

    Covers both LinkedIn shapes:
        /in/aditya-tiwari-3715a6338/                      -> Aditya Tiwari
        /posts/aditya-tiwari-3715a6338_unstop-campus...   -> Aditya Tiwari

    Weaker than a stated name and much weaker than a verified profile, so it is
    only consulted last.
    """
    if not url:
        return None

    m = re.search(r"linkedin\.com/(?:in|posts)/([^/?#]+)", url, re.I)
    if not m:
        return None

    slug = m.group(1).split("_")[0]           # drop the activity suffix
    parts = [p for p in slug.split("-") if p]
    # Trailing member id, e.g. "3715a6338".
    while parts and _ID_TOKEN.search(parts[-1]):
        parts.pop()
    if not parts:
        return None

    return _clean(" ".join(parts))


def resolve_identity_name(
    explicit: str = "",
    review: str = "",
    verified_display_names: Optional[List[str]] = None,
    cited_urls: Optional[List[str]] = None,
) -> Optional[str]:
    """Best available name, or None if the review gives nothing to go on."""
    if explicit and explicit.strip():
        return explicit.strip()[:120]

    stated = name_from_review(review)
    if stated:
        return stated

    for n in (verified_display_names or []):
        if n and n.strip():
            return n.strip()[:120]

    for u in (cited_urls or []):
        guessed = name_from_profile_url(u)
        if guessed:
            return guessed

    return None

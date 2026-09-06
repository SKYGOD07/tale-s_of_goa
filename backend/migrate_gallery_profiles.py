"""
One-off backfill for identities enrolled before profiles were tracked per face.

Older rows recorded only `origin`, so the gallery could not tell a web-reachable
reference (a real profile photo, presentable as a discovered post) from the
operator's own copy of the submitted picture (a self-match, worth nothing as
evidence). This re-fetches each cited profile photo, records the SHA-256 of the
exact bytes, and marks it reachable. Nothing is re-verified biometrically here:
these faces already passed the gate at enrolment time.
"""

import asyncio
import hashlib
import json
import re

from app.services.gallery import GALLERY_PATH, load_gallery, save_gallery
from app.services.teach import _fetch_github_avatar, _github_handle


async def main() -> None:
    gallery = load_gallery()
    changed = 0

    for ident in gallery["identities"]:
        for face in ident["faces"]:
            origin = face.get("origin", "")
            if not origin.startswith("http"):
                face.setdefault("image_url", "")
                face.setdefault("platform", "operator")
                face.setdefault("media_sha256", "")
                face["web_reachable"] = False
                continue

            if face.get("web_reachable") and face.get("media_sha256"):
                continue

            handle = _github_handle(origin)
            if not handle:
                # Not fetchable (login-walled or unsupported). Leave it out of
                # the presentable set rather than guessing.
                face["web_reachable"] = False
                print(f"  skip  {origin} (no fetchable media)")
                continue

            got = await _fetch_github_avatar(handle)
            if not got:
                face["web_reachable"] = False
                print(f"  fail  {origin} (avatar unreachable)")
                continue

            face["image_url"] = got["avatar_url"]
            face["platform"] = "github.com"
            face["media_sha256"] = hashlib.sha256(got["bytes"]).hexdigest()
            face["web_reachable"] = True
            changed += 1
            print(f"  ok    {origin} -> sha256 {face['media_sha256'][:16]}...")

    save_gallery(gallery)
    print(f"\n{changed} face row(s) backfilled in {GALLERY_PATH}")


if __name__ == "__main__":
    asyncio.run(main())

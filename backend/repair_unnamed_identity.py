"""
Split the mixed "Unnamed identity" record into one identity per person.

How it went wrong: a review that cited only LinkedIn could not yield a name,
because only a fetched GitHub profile supplied one. Every such subject was then
filed under the literal string "Unnamed identity" and merged into a single
record. An identity is scored on its CLOSEST stored face, so a record holding
five strangers matches nearly anybody - the corruption is silent and it grows.

The repair is evidence-based rather than guesswork:

  * Each teach appended exactly one operator photo and one review, and both
    carry the same timestamp, so every face can be paired with the review that
    created it.
  * Faces are then clustered by biometric agreement at the SFace operating
    point, using complete linkage so that one borderline face cannot bridge
    two different people.
  * Each cluster is named from its own members' reviews, and inherits only the
    URLs those reviews cited - so no profile link is attributed to a person who
    was never associated with it.

Faces the operator never named and that match nobody end up as their own
"Unidentified subject N", which is the honest outcome: separate until named.

Run:  python repair_unnamed_identity.py [--apply]
Without --apply it prints the plan and changes nothing.
"""

import argparse
import json
import sys
from collections import Counter
from typing import Any, Dict, List

import numpy as np

from app.services.face_processor import SFACE_L2_THRESHOLD
from app.services.gallery import load_gallery, save_gallery
from app.services.naming import name_from_review, name_from_profile_url

TARGET = "Unnamed identity"


def cluster(embeddings: List[np.ndarray], threshold: float) -> List[List[int]]:
    """
    Complete-link clustering: a face joins a group only if it matches EVERY
    face already in it.

    Single-link would be wrong here. It merges two groups on one qualifying
    pair, so a single borderline face bridges two different people and the
    mixing this script exists to undo silently reappears. Complete-link errs
    the other way - it can split one person into two records when their photos
    vary a lot - and that error is recoverable: the operator re-teaches and the
    two merge. A wrongly merged identity is not recoverable by any amount of
    further teaching.
    """
    n = len(embeddings)
    d = [[float(np.linalg.norm(embeddings[i] - embeddings[j])) for j in range(n)]
         for i in range(n)]

    groups: List[List[int]] = []
    for i in range(n):
        # Join the group whose worst-case distance to this face is smallest,
        # provided every member still passes.
        best, best_worst = None, None
        for g in groups:
            worst = max(d[i][j] for j in g)
            if worst <= threshold and (best_worst is None or worst < best_worst):
                best, best_worst = g, worst
        if best is None:
            groups.append([i])
        else:
            best.append(i)

    return sorted(groups, key=len, reverse=True)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="write the change")
    ap.add_argument("--threshold", type=float, default=SFACE_L2_THRESHOLD)
    args = ap.parse_args()

    gallery = load_gallery()
    ident = next((i for i in gallery["identities"] if i["name"] == TARGET), None)
    if ident is None:
        print(f"No {TARGET!r} record - nothing to repair.")
        return 0

    faces = ident["faces"]
    reviews = sorted(ident.get("reviews", []), key=lambda r: r["at"])

    # Pair each face with the review written at the same moment.
    by_time = {r["at"]: r["text"] for r in reviews}
    for f in faces:
        f["_review"] = by_time.get(f.get("added_at"), "")

    unpaired = sum(1 for f in faces if not f["_review"])
    print(f"{len(faces)} faces, {len(reviews)} reviews, {unpaired} face(s) without a review")

    embeddings = [np.array(f["embedding"], dtype=np.float32) for f in faces]
    clusters = cluster(embeddings, args.threshold)
    print(f"\n{len(clusters)} distinct person(s) at L2 <= {args.threshold}:\n")

    used = {i["name"] for i in gallery["identities"] if i["name"] != TARGET}
    plan: List[Dict[str, Any]] = []
    unnamed_n = 0

    for members in clusters:
        texts = [faces[i]["_review"] for i in members]

        # A name stated in any of this cluster's own reviews wins; the most
        # frequently stated one wins a tie.
        stated = Counter(n for n in (name_from_review(t) for t in texts) if n)
        urls = [u for t in texts for u in _urls(t)]
        slug = next((n for n in (name_from_profile_url(u) for u in urls) if n), None)

        if stated:
            name = stated.most_common(1)[0][0]
            src = "stated in the review"
        elif slug:
            name = slug
            src = "from the cited profile URL"
        else:
            unnamed_n += 1
            name = f"Unidentified subject {unnamed_n}"
            while name in used:
                unnamed_n += 1
                name = f"Unidentified subject {unnamed_n}"
            src = "never named - kept separate"

        while name in used:
            name = f"{name} (2)"
        used.add(name)

        plan.append({"name": name, "src": src, "members": members,
                     "urls": sorted(set(urls)), "texts": texts})

        print(f"  {name}  [{src}]  -  {len(members)} face(s)")
        for u in sorted(set(urls)):
            print(f"      {u}")
        for t in texts:
            print(f"      review: {t[:78]}")
        print()

    if not args.apply:
        print("Dry run. Re-run with --apply to write it.")
        return 0

    gallery["identities"] = [i for i in gallery["identities"] if i["name"] != TARGET]
    for c in plan:
        members = c["members"]
        gallery["identities"].append({
            "name": c["name"],
            "created_at": min(faces[i].get("added_at", "") for i in members),
            "updated_at": max(faces[i].get("added_at", "") for i in members),
            "source_urls": c["urls"],
            "reviews": [{"at": faces[i].get("added_at", ""), "text": faces[i]["_review"]}
                        for i in members if faces[i]["_review"]],
            "faces": [{k: v for k, v in faces[i].items() if k != "_review"}
                      for i in members],
        })

    save_gallery(gallery)
    print(f"Applied: {TARGET!r} split into {len(plan)} identities.")
    return 0


def _urls(text: str) -> List[str]:
    import re
    return [u.rstrip(".,;)") for u in re.findall(r"https?://[^\s,)<>\"']+", text or "")]


if __name__ == "__main__":
    sys.exit(main())

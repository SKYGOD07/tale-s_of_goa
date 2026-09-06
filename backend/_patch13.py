import pathlib

p = pathlib.Path("app/services/social_search.py")
s = p.read_text(encoding="utf-8")

OLD = """    gallery_primary = None
    if gallery_hit["match"]:
        g = gallery_hit["match"]
        verified_url = next((u for u in g.get("source_urls", []) if u), "")
        gallery_primary = Candidate(
            page_url=verified_url or g["matched_origin"],
            image_url=g.get("thumbnail", ""),
            title=g["name"],
            description=(
                f"Enrolled identity, recognised from {g['reference_count']} verified "
                f"reference photo(s)."
            ),
            author=g["name"],
            platform=detect_platform(verified_url) if verified_url else "Enrolled gallery",
            source="gallery:enrolled",
        )
        gallery_primary.faces_found = 1
        gallery_primary.best_l2 = g["euclidean_distance"]
        gallery_primary.best_cosine = g["cosine_similarity"]
        gallery_primary.similarity_pct = g["similarity_percentage"]
        gallery_primary.is_match = True
        gallery_primary.face_crop_b64 = g.get("thumbnail", "")

        if match is None or g["euclidean_distance"] <= (match.best_l2 or 9.9):
            print(f"[Pipeline] gallery identity outranks the web result "
                  f"(L2 {g['euclidean_distance']:.4f}); using it as the primary answer")
            match = gallery_primary
            all_matches = [gallery_primary] + [
                m for m in all_matches if m.page_url != gallery_primary.page_url
            ]"""

NEW = '''    gallery_primary = None
    gallery_profiles = []
    if gallery_hit["match"]:
        g = gallery_hit["match"]

        # Task 3 wants a real, matching post - so the result must be a profile
        # that exists on the web and whose OWN photo matched. The operator's
        # copy of the picture is excluded: scoring a photo against itself gives
        # L2 0.0 and proves nothing, and a local file is not a discovered post.
        passing = [pr for pr in g.get("profiles", []) if pr["is_match"]]

        for pr in passing:
            cand = Candidate(
                page_url=pr["url"],
                image_url=pr["image_url"] or pr["thumbnail"],
                title=f"{g['name']} - {pr['platform'] or detect_platform(pr['url'])} profile",
                description=(
                    f"Enrolled identity. This profile's own photo matches the scan at "
                    f"L2 {pr['euclidean_distance']:.4f}."
                ),
                author=g["name"],
                platform=pr["platform"] or detect_platform(pr["url"]),
                source="gallery:verified_profile",
            )
            cand.faces_found = 1
            cand.best_l2 = pr["euclidean_distance"]
            cand.best_cosine = pr["cosine_similarity"]
            cand.similarity_pct = pr["similarity_percentage"]
            cand.is_match = True
            cand.face_crop_b64 = pr["thumbnail"]
            cand.media_sha256 = pr["media_sha256"]
            gallery_profiles.append(cand)

        if gallery_profiles:
            gallery_primary = gallery_profiles[0]
            if match is None or gallery_primary.best_l2 <= (match.best_l2 or 9.9):
                print(f"[Pipeline] enrolled profile outranks the web result: "
                      f"{gallery_primary.page_url} (L2 {gallery_primary.best_l2:.4f})")
                match = gallery_primary
                known_urls = {c.page_url for c in gallery_profiles}
                all_matches = gallery_profiles + [
                    m for m in all_matches if m.page_url not in known_urls
                ]
        else:
            # Recognised, but every stored reference is the operator's own copy.
            # There is nothing web-reachable to present, so the web result (or
            # an honest no-match) stands and the banner still names the person.
            print(f"[Pipeline] recognised {g['name']}, but no web-reachable "
                  f"profile is enrolled for them - teach one to surface it")'''

assert OLD in s, "gallery primary anchor not found"
s = s.replace(OLD, NEW, 1)

# Expose the full profile list so the UI can show every matching profile.
s = s.replace('''        "known_identity": gallery_hit["match"],''',
'''        "known_identity": gallery_hit["match"],
        "identity_profiles": [
            {
                "url": c.page_url,
                "platform": c.platform,
                "image_url": c.image_url,
                "face_crop_base64": c.face_crop_b64,
                "media_sha256": c.media_sha256,
                "similarity_percentage": c.similarity_pct,
                "euclidean_distance": c.best_l2,
                "cosine_similarity": c.best_cosine,
                "verified": True,
            }
            for c in gallery_profiles
        ],
        "asserted_profiles": (gallery_hit["match"] or {}).get("asserted_profiles", []),''', 1)

p.write_text(s, encoding="utf-8")
print("pipeline: verified profiles are now the discovered post")

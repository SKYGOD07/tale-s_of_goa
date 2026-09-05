"""
================================================================================
HH GOA 2026 Task #3 - CLI end-to-end pipeline

  Face scan input -> genuine web/social search -> blockchain upload & re-verify

Terminal only. No browser, no frontend, no GUI.

  python run_pipeline.py --image path/to/face.jpg
  python run_pipeline.py --image path/to/face.jpg --query "Linus Torvalds"
  python run_pipeline.py --image path/to/face.jpg --json

A run that finds nobody prints NO MATCH FOUND and exits 2. That is a correct
outcome, not a failure - the pipeline never substitutes a stand-in identity.
================================================================================
"""

import sys
import os
import argparse
import asyncio
import base64
import json
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.services.social_search import (
    run_social_search_and_verification_pipeline,
    NoMatchFound,
)
from app.services.face_processor import models_ready, SFACE_L2_THRESHOLD
from app.services.face_search import search_capabilities
from app.services.blockchain import chain_status

RULE = "=" * 80
SUB = "-" * 80


def banner():
    print(f"""
{RULE}
  HH GOA 2026 - TASK 3: FACE IDENTIFICATION & BLOCKCHAIN VERIFICATION
{RULE}
  [Face scan input] -> [Web/social search] -> [Blockchain upload & re-verify]
{RULE}
""")


def load_image_b64(path: str) -> str:
    with open(path, "rb") as f:
        raw = f.read()
    ext = os.path.splitext(path)[1].lstrip(".").lower()
    mime = "image/png" if ext == "png" else "image/jpeg"
    return f"data:{mime};base64," + base64.b64encode(raw).decode()


async def main() -> int:
    ap = argparse.ArgumentParser(description="HH GOA Task 3 CLI pipeline")
    ap.add_argument("--image", required=True, help="Path to the input face image")
    ap.add_argument("--query", default="",
                    help="Optional search hint. Omit for pure face-driven discovery "
                         "(needs a reverse-image API key).")
    ap.add_argument("--threshold", type=float, default=SFACE_L2_THRESHOLD,
                    help=f"SFace L2 match threshold (default {SFACE_L2_THRESHOLD}). "
                         "Do not widen this to force a match.")
    ap.add_argument("--json", action="store_true", help="Emit the raw result as JSON")
    args = ap.parse_args()

    if not os.path.exists(args.image):
        print(f"[ERROR] Image not found: {args.image}")
        return 1

    banner()

    # ── Environment ──────────────────────────────────────────────────────
    models = models_ready()
    caps = search_capabilities()
    chain = chain_status()

    print(">>> ENVIRONMENT")
    print(SUB)
    print(f"  Detector        : {models['detector'] or 'NOT LOADED'}")
    print(f"  Recognizer      : {models['recognizer'] or 'NOT LOADED'}")
    print(f"  Thresholds      : cosine >= {models['cosine_threshold']} | L2 <= {models['l2_threshold']}")
    print(f"  Search mode     : {caps['mode']}")
    print(f"  Reverse image   : {caps['reverse_image_search'] or 'not configured'}")
    print(f"  Live search     : {caps['live_search_engine'] or 'unavailable'}")
    print(f"  Chain           : {chain['network']} (chainId {chain['chain_id']})")
    print(f"  Chain live      : {chain['live']}   contract: {chain['contract_address'] or 'NOT SET'}")
    if not chain["live"]:
        print(f"  NOTE            : {chain['message']}")

    if not (models["detector_loaded"] and models["recognizer_loaded"]):
        print("\n[ERROR] Face models are not loaded. See SETUP/OPERATIONS docs.")
        return 1

    face_b64 = load_image_b64(args.image)

    print(f"\n  Input           : {args.image}")
    print(f"  Discovery       : {'hint = ' + repr(args.query) if args.query else 'face-driven (no hint)'}")
    print(f"  Threshold (L2)  : {args.threshold}")

    print(f"\n{SUB}\n>>> [STEP 1/3] FACE DETECTION, ALIGNMENT & 128-D ENCODING\n{SUB}")
    print("  YuNet.detect() -> box + 5 landmarks")
    print("  SFace.alignCrop() -> canonical 112x112")
    print("  SFace.feature() -> 128-D identity vector (L2 normalised)")

    print(f"\n{SUB}\n>>> [STEP 2/3] GENUINE WEB / SOCIAL DISCOVERY\n{SUB}")
    print("  Candidates come from a live query. Every candidate image is")
    print("  downloaded, every face in it is embedded, and only a candidate")
    print("  passing the threshold can be returned.")

    started = time.time()
    try:
        result = await run_social_search_and_verification_pipeline(
            face_input_b64=face_b64,
            search_query=args.query,
            threshold=args.threshold,
        )
    except NoMatchFound as nm:
        d = nm.discovery or {}
        print(f"\n{RULE}")
        print("  NO MATCH FOUND")
        print(RULE)
        print(f"  {nm}")
        print(f"\n  Mechanisms      : {d.get('search_mechanisms') or ['none']}")
        print(f"  Candidates      : {d.get('candidates_considered', 0)} considered, "
              f"{d.get('candidates_verified', 0)} face-verified")
        for c in (d.get("candidate_report") or [])[:10]:
            dist = c.get("euclidean_distance")
            print(f"    L2={('%.4f' % dist) if dist is not None else '  -   '}  "
                  f"faces={c.get('faces_found', 0):<3} {c.get('image_url', '')[:56]}")
        print(f"\n  This is a correct result. No identity was invented.\n{RULE}")
        if args.json:
            print(json.dumps({"match_found": False, "message": str(nm), "discovery": d},
                             indent=2, default=str))
        return 2
    except ValueError as ve:
        print(f"\n[ERROR] {ve}")
        return 1

    elapsed = round(time.time() - started, 2)
    post = result["discovered_post"]
    metrics = result["metrics"]
    diag = (result.get("diagnostics") or {}).get("search") or {}
    tx = result["blockchain_upload"]
    onchain = result["onchain_reverification"]
    tamper = result.get("tamper_check") or {}

    print(f"\n  [MATCH FOUND in {elapsed}s]")
    print(f"    Mechanism     : {diag.get('mechanisms')}")
    print(f"    Candidates    : {diag.get('candidates_considered')} considered / "
          f"{diag.get('candidates_verified')} verified")
    print(f"    Platform      : {post['platform']}")
    print(f"    Author        : {post['author']}")
    print(f"    Post URL      : {post['url']}")
    print(f"    Post image    : {post['image_url']}")
    print(f"\n  [BIOMETRIC VERIFICATION]")
    print(f"    Cosine sim    : {metrics['cosine_similarity']:+.4f}")
    print(f"    Euclidean L2  : {metrics['euclidean_distance']:.4f}  (threshold {args.threshold})")
    print(f"    Similarity    : {metrics['similarity_percentage']}%")
    print(f"    Verdict       : {'MATCH CONFIRMED' if metrics['is_match'] else 'MISMATCH'}")

    print(f"\n{SUB}\n>>> [STEP 3/3] BLOCKCHAIN COMMITMENT & ON-CHAIN RE-VERIFICATION\n{SUB}")
    print(f"  Canonical JSON -> SHA-256 fingerprint:")
    print(f"    Record hash   : {result['record_hash']}")
    print(f"\n  Submitting to FaceVerification.recordVerification(bytes32)...")
    print(f"    Network       : {tx.get('network')}")
    print(f"    Simulated     : {tx.get('simulated')}")
    print(f"    Tx hash       : {tx.get('transaction_hash')}")
    print(f"    Block         : #{tx.get('block_number')}   gas {tx.get('gas_used')}")
    print(f"    Status        : {str(tx.get('status')).upper()}")
    if tx.get("explorer_url"):
        print(f"    Explorer      : {tx['explorer_url']}")

    print(f"\n  Reading back via getVerification(bytes32)...")
    print(f"    Exists on-chain : {onchain.get('exists_on_chain')}")
    print(f"    Block timestamp : {onchain.get('timestamp')} ({onchain.get('timestamp_iso')})")
    print(f"    Recorder        : {onchain.get('recorder')}")

    print(f"\n  Tamper check (re-hash the record, compare with the chain):")
    print(f"    Recomputed      : {tamper.get('recomputed_hash')}")
    print(f"    Stored          : {tamper.get('stored_hash')}")
    print(f"    Identical       : {tamper.get('hashes_identical')}")
    print(f"    VERDICT         : {tamper.get('verdict')}")

    ok = metrics["is_match"] and tamper.get("verdict") == "VERIFIED"
    print(f"\n{RULE}")
    print(f"  PIPELINE {'COMPLETE - TAMPER-EVIDENT PROOF VERIFIED ON-CHAIN' if ok else 'FINISHED WITH WARNINGS'}")
    if tx.get("simulated"):
        print("  WARNING: the chain was not reachable/configured; the proof was NOT broadcast.")
    print(RULE)

    if args.json:
        print(json.dumps(result, indent=2, default=str))

    return 0 if ok else 3


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))

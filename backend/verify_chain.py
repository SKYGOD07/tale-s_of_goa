"""
================================================================================
HH GOA 2026 Task #3 - blockchain operations, terminal only.

Drives the FaceVerification smart contract directly, with no frontend:

  python verify_chain.py status
  python verify_chain.py commit --file record.json
  python verify_chain.py commit --text "any string"
  python verify_chain.py query  --hash 0x<64 hex>
  python verify_chain.py demo   --file record.json

`demo` is the one to record for the submission: it commits a record, reads it
back off-chain, then alters a single character and shows the chain reporting
the altered record as absent - the tamper-evidence proof, end to end.
================================================================================
"""

import sys
import os
import json
import copy
import argparse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.services.hashing import generate_canonical_hash
from app.services.blockchain import (
    chain_status,
    submit_record_hash_to_blockchain,
    query_verification_record,
    format_bytes32_hash,
)

RULE = "=" * 78
SUB = "-" * 78


def show_status() -> int:
    s = chain_status()
    print(f"\n{RULE}\n  CHAIN STATUS\n{RULE}")
    for k in ("network", "chain_id", "rpc_url", "contract_address", "account",
              "balance_eth", "block_number", "configured", "connected", "live"):
        print(f"  {k:<18}: {s.get(k)}")
    if s.get("explorer_url"):
        print(f"  {'explorer':<18}: {s['explorer_url']}")
    print(f"  {'message':<18}: {s.get('message')}")
    print(RULE)
    return 0 if s.get("live") else 1


def load_record(args) -> dict:
    """A record is any JSON object; its canonical serialisation is what is hashed."""
    if args.file:
        with open(args.file, "r", encoding="utf-8") as f:
            return json.load(f)
    if args.text:
        return {"payload": args.text}
    # Nothing supplied: use a small illustrative record so `demo` runs standalone.
    return {
        "pipeline": "HH_GOA_2026_TASK_3",
        "record_type": "WEB_SOCIAL_FACE_VERIFICATION",
        "discovered_post": {
            "url": "https://example.org/post/1",
            "platform": "Web",
            "author": "demo",
        },
        "verification_metrics": {
            "euclidean_distance": 0.8467,
            "cosine_similarity": 0.6415,
            "is_match": True,
        },
    }


def do_commit(args) -> int:
    record = load_record(args)
    h = "0x" + generate_canonical_hash(record)
    print(f"\n{RULE}\n  COMMIT\n{RULE}")
    print(f"  canonical SHA-256 : {h}")
    tx = submit_record_hash_to_blockchain(h)
    print(f"  network           : {tx['network']}")
    print(f"  simulated         : {tx['simulated']}")
    print(f"  tx hash           : {tx['transaction_hash']}")
    print(f"  block             : {tx.get('block_number')}   gas {tx.get('gas_used')}")
    print(f"  status            : {tx['status']}")
    if tx.get("explorer_url"):
        print(f"  explorer          : {tx['explorer_url']}")
    if tx.get("error"):
        print(f"  note              : {tx['error']}")
    print(RULE)
    return 0 if not tx["simulated"] and tx["status"] == "confirmed" else 1


def do_query(args) -> int:
    h = format_bytes32_hash(args.hash)
    print(f"\n{RULE}\n  QUERY\n{RULE}")
    print(f"  hash              : {h}")
    q = query_verification_record(h)
    print(f"  exists_on_chain   : {q['exists_on_chain']}")
    print(f"  recorder          : {q.get('recorder')}")
    print(f"  timestamp         : {q.get('timestamp')} ({q.get('timestamp_iso')})")
    print(f"  network           : {q['network']}")
    if q.get("error"):
        print(f"  note              : {q['error']}")
    print(RULE)
    return 0 if q["exists_on_chain"] else 1


def do_demo(args) -> int:
    """Write -> read back -> tamper -> read back. The full evidence chain."""
    record = load_record(args)

    print(f"\n{RULE}\n  TAMPER-EVIDENCE DEMONSTRATION\n{RULE}")
    s = chain_status()
    print(f"  chain             : {s['network']} (chainId {s['chain_id']})")
    print(f"  contract          : {s['contract_address']}")
    print(f"  live              : {s['live']}")
    if not s["live"]:
        print(f"\n  Chain is not live: {s['message']}")
        print("  Start it and deploy first - see OPERATIONS.md.")
        print(RULE)
        return 1

    print(f"\n{SUB}\n  1. ORIGINAL RECORD\n{SUB}")
    print(json.dumps(record, indent=2)[:600])

    h = "0x" + generate_canonical_hash(record)
    print(f"\n{SUB}\n  2. CANONICAL SHA-256 FINGERPRINT\n{SUB}")
    print(f"  {h}")

    print(f"\n{SUB}\n  3. COMMIT TO CHAIN\n{SUB}")
    tx = submit_record_hash_to_blockchain(h)
    print(f"  tx hash           : {tx['transaction_hash']}")
    print(f"  block             : {tx.get('block_number')}   gas {tx.get('gas_used')}")
    print(f"  simulated         : {tx['simulated']}")
    if tx["simulated"]:
        print(f"\n  Not broadcast: {tx.get('error')}")
        print(RULE)
        return 1

    print(f"\n{SUB}\n  4. READ BACK FROM THE CONTRACT\n{SUB}")
    q = query_verification_record(h)
    print(f"  exists_on_chain   : {q['exists_on_chain']}")
    print(f"  recorder          : {q.get('recorder')}")
    print(f"  timestamp         : {q.get('timestamp_iso')}")

    print(f"\n{SUB}\n  5. RE-HASH THE UNCHANGED RECORD -> must equal step 2\n{SUB}")
    recomputed = "0x" + generate_canonical_hash(record)
    print(f"  recomputed        : {recomputed}")
    print(f"  identical         : {recomputed == h}")
    verified = (recomputed == h) and q["exists_on_chain"]
    print(f"  VERDICT           : {'VERIFIED' if verified else 'UNVERIFIED'}")

    print(f"\n{SUB}\n  6. TAMPER: alter ONE value, re-hash, ask the chain\n{SUB}")
    tampered = copy.deepcopy(record)
    # Nudge a nested numeric field if there is one, else the whole payload.
    vm = tampered.get("verification_metrics")
    if isinstance(vm, dict) and isinstance(vm.get("euclidean_distance"), (int, float)):
        before = vm["euclidean_distance"]
        vm["euclidean_distance"] = round(before + 0.0001, 6)
        print(f"  changed           : verification_metrics.euclidean_distance "
              f"{before} -> {vm['euclidean_distance']}")
    else:
        tampered["_tampered"] = True
        print("  changed           : injected _tampered = true")

    th = "0x" + generate_canonical_hash(tampered)
    print(f"  tampered hash     : {th}")
    tq = query_verification_record(th)
    print(f"  exists_on_chain   : {tq['exists_on_chain']}")
    detected = not tq["exists_on_chain"]
    print(f"  VERDICT           : {'TAMPERED - DETECTED' if detected else 'FAILED TO DETECT'}")

    ok = verified and detected
    print(f"\n{RULE}")
    print(f"  {'TAMPER-EVIDENCE PROVEN' if ok else 'DEMONSTRATION INCOMPLETE'}")
    print(f"  A single altered digit produces a different fingerprint, which the")
    print(f"  contract has no record of. The original remains verifiable.")
    print(RULE)
    return 0 if ok else 1


def main() -> int:
    ap = argparse.ArgumentParser(description="Task 3 blockchain operations (terminal only)")
    sub = ap.add_subparsers(dest="cmd", required=True)

    sub.add_parser("status", help="Show chain, contract and account state")

    c = sub.add_parser("commit", help="Hash a record and write it on-chain")
    c.add_argument("--file", help="Path to a JSON record")
    c.add_argument("--text", help="Any string to fingerprint instead")

    q = sub.add_parser("query", help="Ask the contract whether a hash exists")
    q.add_argument("--hash", required=True, help="0x-prefixed 64-hex record hash")

    d = sub.add_parser("demo", help="Commit, read back, tamper, and re-check")
    d.add_argument("--file", help="Path to a JSON record")
    d.add_argument("--text", help="Any string to fingerprint instead")

    args = ap.parse_args()
    return {"status": lambda a: show_status(),
            "commit": do_commit,
            "query": do_query,
            "demo": do_demo}[args.cmd](args)


if __name__ == "__main__":
    sys.exit(main())

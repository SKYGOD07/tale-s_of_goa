"""
Operator feedback capture.

The decision threshold is the one tunable the pipeline has, and picking it well
needs labelled evidence rather than intuition. Every time an operator marks a
result correct or incorrect, the score that produced it is appended here with
its label. That file is the training set for threshold calibration - see
notebooks/threshold_calibration.ipynb.

Deliberately NOT stored: the images themselves, or any embedding. Only the
distance, the label and the provenance are kept, so the log is safe to inspect
and carries no biometric data.

Honest scope: this calibrates the DECISION BOUNDARY from your labels. It does
not fine-tune SFace - retraining a face recognition network needs tens of
thousands of labelled identities and a GPU, and a handful of feedback clicks
cannot do it. Threshold calibration is the part that genuinely improves with
your input, and on a per-deployment basis it is the part that matters most.
"""

import json
import os
import threading
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "..", "data")
FEEDBACK_PATH = os.path.abspath(os.path.join(_DIR, "feedback.jsonl"))

# Appends arrive from FastAPI's threadpool, so serialise them.
_LOCK = threading.Lock()

VALID_LABELS = ("correct", "incorrect", "unsure")


def _ensure_dir() -> None:
    os.makedirs(os.path.dirname(FEEDBACK_PATH), exist_ok=True)


def build_review_record(entry: Dict[str, Any]) -> Dict[str, Any]:
    """
    Canonical, hashable form of one operator review.

    Deliberately excludes the wall-clock timestamp of the click: the chain
    supplies its own block.timestamp, and including a local clock would make
    the same judgement hash differently on two machines.
    """
    return {
        "record_type": "OPERATOR_REVIEW",
        "version": "1.0",
        "label": entry["label"],
        "written_review": entry.get("note", ""),
        "metrics": {
            "euclidean_distance": entry.get("euclidean_distance"),
            "cosine_similarity": entry.get("cosine_similarity"),
            "threshold_used": entry.get("threshold_used"),
            "system_verdict": entry.get("system_verdict"),
        },
        "subject": {
            "page_url": entry.get("page_url", ""),
            "platform": entry.get("platform", ""),
            "discovery_source": entry.get("discovery_source", ""),
            "media_sha256": entry.get("media_sha256", ""),
        },
        # Links this review back to the pipeline record it judges.
        "reviews_record_hash": entry.get("record_hash", ""),
    }


def record_feedback(
    label: str,
    euclidean_distance: float,
    cosine_similarity: Optional[float] = None,
    threshold_used: Optional[float] = None,
    system_verdict: Optional[bool] = None,
    page_url: str = "",
    platform: str = "",
    discovery_source: str = "",
    media_sha256: str = "",
    record_hash: str = "",
    note: str = "",
    commit_on_chain: bool = False,
    probe_embedding: Optional[List[float]] = None,
) -> Dict[str, Any]:
    """
    Append one labelled observation.

    `label` is the operator's ground truth: was this genuinely the same person?
    `system_verdict` is what the pipeline decided, so agreement and the four
    confusion-matrix cells can be derived later.
    """
    if label not in VALID_LABELS:
        raise ValueError(f"label must be one of {VALID_LABELS}, got {label!r}")

    entry = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "label": label,
        "euclidean_distance": round(float(euclidean_distance), 6),
        "cosine_similarity": None if cosine_similarity is None else round(float(cosine_similarity), 6),
        "threshold_used": None if threshold_used is None else round(float(threshold_used), 6),
        "system_verdict": system_verdict,
        "page_url": page_url,
        "platform": platform,
        "discovery_source": discovery_source,
        "media_sha256": media_sha256,
        "record_hash": record_hash,
        "note": note[:2000],
        # Kept so a rejection can be scoped to the face it was made about.
        # Without it, "not them" would suppress an image for everyone - and an
        # image that is wrong for one person may be exactly right for another.
        "probe_embedding": probe_embedding,
    }

    # A written review is evidence about evidence. Anchoring it makes the
    # judgement itself tamper-evident: the text cannot later be quietly
    # rewritten and still match what the chain holds.
    entry["review_record"] = build_review_record(entry)
    entry["review_sha256"] = None
    entry["chain"] = None

    if commit_on_chain:
        try:
            from app.services.hashing import generate_canonical_hash
            from app.services.blockchain import submit_record_hash_to_blockchain

            review_hash = "0x" + generate_canonical_hash(entry["review_record"])
            entry["review_sha256"] = review_hash
            tx = submit_record_hash_to_blockchain(review_hash)
            entry["chain"] = {
                "transaction_hash": tx.get("transaction_hash"),
                "block_number": tx.get("block_number"),
                "network": tx.get("network"),
                "simulated": tx.get("simulated"),
                "status": tx.get("status"),
                "explorer_url": tx.get("explorer_url"),
            }
        except Exception as e:
            print(f"[Feedback] on-chain commit failed: {e}")
            entry["chain"] = {"error": str(e), "simulated": True}

    _ensure_dir()
    with _LOCK:
        with open(FEEDBACK_PATH, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(entry, ensure_ascii=False) + "\n")

    return entry


def load_feedback() -> List[Dict[str, Any]]:
    """Every labelled observation recorded so far."""
    if not os.path.exists(FEEDBACK_PATH):
        return []
    out: List[Dict[str, Any]] = []
    with open(FEEDBACK_PATH, "r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return out


def suggest_threshold(step: float = 0.005) -> Dict[str, Any]:
    """
    Sweep candidate thresholds over the labelled data and report the one with
    the best balanced accuracy.

    'correct' means the two faces really are the same person, so a good
    threshold accepts those and rejects the 'incorrect' ones. 'unsure' rows are
    ignored. With few labels the answer is noisy, which is why the sample count
    is returned alongside it - treat a suggestion built on a handful of rows as
    a hint, not an instruction.
    """
    rows = [r for r in load_feedback() if r.get("label") in ("correct", "incorrect")]
    same = [r["euclidean_distance"] for r in rows if r["label"] == "correct"]
    diff = [r["euclidean_distance"] for r in rows if r["label"] == "incorrect"]

    result: Dict[str, Any] = {
        "samples": len(rows),
        "same_person": len(same),
        "different_person": len(diff),
        "suggested_threshold": None,
        "balanced_accuracy": None,
        "published_default": 1.128,
        "confident": False,
        "message": "",
    }

    if not same or not diff:
        result["message"] = (
            "Need at least one 'correct' and one 'incorrect' label before a "
            "threshold can be suggested."
        )
        return result

    lo = max(0.20, min(same + diff) - 0.10)
    hi = min(1.60, max(same + diff) + 0.10)

    best_t, best_score = None, -1.0
    t = lo
    while t <= hi:
        tpr = sum(1 for d in same if d <= t) / len(same)      # genuine accepted
        tnr = sum(1 for d in diff if d > t) / len(diff)       # impostor rejected
        score = (tpr + tnr) / 2
        if score > best_score:
            best_score, best_t = score, t
        t += step

    result["suggested_threshold"] = round(best_t, 4)
    result["balanced_accuracy"] = round(best_score, 4)
    # Under ~10 labelled pairs of each class the estimate moves a lot with one
    # more observation, so say so rather than implying precision.
    result["confident"] = len(same) >= 10 and len(diff) >= 10
    result["message"] = (
        f"Suggested L2 threshold {result['suggested_threshold']} from {len(rows)} labels "
        f"({len(same)} same-person, {len(diff)} different-person), balanced accuracy "
        f"{result['balanced_accuracy']:.3f}. "
        + ("" if result["confident"]
           else "Small sample - treat as indicative and keep labelling.")
    )
    return result


def feedback_stats() -> Dict[str, Any]:
    """Counts and agreement rate, for the UI badge."""
    rows = load_feedback()
    labelled = [r for r in rows if r.get("label") in ("correct", "incorrect")]
    agreed = sum(
        1 for r in labelled
        if r.get("system_verdict") is not None
        and bool(r["system_verdict"]) == (r["label"] == "correct")
    )
    return {
        "total": len(rows),
        "correct": sum(1 for r in rows if r.get("label") == "correct"),
        "incorrect": sum(1 for r in rows if r.get("label") == "incorrect"),
        "unsure": sum(1 for r in rows if r.get("label") == "unsure"),
        "agreement_rate": round(agreed / len(labelled), 4) if labelled else None,
        "path": FEEDBACK_PATH,
    }


def suppressed_media(
    probe_embedding: Optional[List[float]],
    threshold: float = 1.128,
) -> set:
    """
    Media fingerprints the operator has already rejected FOR THIS FACE.

    Scoped deliberately. A global blocklist would be wrong: a photo that is not
    person A can perfectly well be person B, and suppressing it everywhere would
    hide correct answers. So a past rejection only applies when the probe now
    being searched is the same face that rejected it.

    Falls back to page URLs when a candidate carried no media hash.
    """
    from app.services.face_processor import evaluate_face_similarity

    out = set()
    if not probe_embedding:
        return out

    for row in load_feedback():
        if row.get("label") != "incorrect":
            continue
        key = row.get("media_sha256") or row.get("page_url")
        if not key:
            continue

        past = row.get("probe_embedding")
        if not past:
            # Older rows predate probe capture. Applying them blindly risks
            # hiding a legitimate result, so they are ignored rather than
            # guessed at.
            continue

        is_same, _, _, _ = evaluate_face_similarity(probe_embedding, past, threshold=threshold)
        if is_same:
            out.add(key)

    return out

# Architecture

How the pipeline works internally — module by module, decision by decision.

---

## Contents

1. [System shape](#1-system-shape)
2. [Repository layout](#2-repository-layout)
3. [Stage 1 — face detection](#3-stage-1--face-detection)
4. [Stage 2 — alignment and embedding](#4-stage-2--alignment-and-embedding)
5. [Stage 3 — matching and thresholds](#5-stage-3--matching-and-thresholds)
6. [Stage 4 — genuine web/social discovery](#6-stage-4--genuine-websocial-discovery)
7. [Stage 5 — candidate verification](#7-stage-5--candidate-verification)
8. [Stage 6 — canonical record and fingerprint](#8-stage-6--canonical-record-and-fingerprint)
9. [Stage 7 — blockchain commit and re-verification](#9-stage-7--blockchain-commit-and-re-verification)
10. [Frontend](#10-frontend)
11. [Design rules the code enforces](#11-design-rules-the-code-enforces)
12. [Audit history — what was wrong before](#12-audit-history--what-was-wrong-before)

---

## 1. System shape

Three independent stacks that talk over HTTP and JSON-RPC.

```
┌──────────────────────┐        ┌───────────────────────────┐
│  frontend/           │  HTTP  │  backend/                 │
│  Next.js 16 + React  │───────▶│  FastAPI + OpenCV + web3  │
│  (OPTIONAL)          │  :8000 │                           │
└──────────────────────┘        └────────────┬──────────────┘
                                             │ JSON-RPC :8545
                                             ▼
                                ┌───────────────────────────┐
                                │  blockchain/              │
                                │  Hardhat EVM + Solidity   │
                                │  FaceVerification.sol     │
                                └───────────────────────────┘
                                             │
                     ┌───────────────────────┴────────────────┐
                     │  Local Hardhat node (31337)            │
                     │  …or Ethereum Sepolia (11155111)       │
                     └────────────────────────────────────────┘
```

The frontend is genuinely optional — `run_pipeline.py` and `verify_chain.py`
exercise the whole system from a terminal. The task explicitly says no website
is required.

### End-to-end data flow

```
  input image (JPEG/PNG, any size, any aspect ratio)
        │
        │  decode_base64_image()      EXIF orientation applied
        ▼
  BGR ndarray  (e.g. 1280×720×3)
        │
        │  detect_faces_detailed()    YuNet, full image, no centre crop
        ▼
  [FaceDetection…]  box + score + 5 landmarks + raw YuNet row
        │
        │  align_face()               SFace.alignCrop() using the landmarks
        ▼
  aligned BGR  112×112×3              canonical pose
        │
        │  encode_aligned_face()      SFace.feature()
        ▼
  feature  1×128 float32
        │
        │  feature_to_list()          L2 normalise → 128 floats
        ▼
  embedding  [-0.121, 0.0347, …]
        │
        ├──────────────────────────────────────────┐
        │                                          │
        ▼                                          ▼
  discovery (live search)                   1-to-1 compare
        │                                          │
        │  every candidate image:                  │  SFace.match()
        │    download → detect ALL faces           │  cosine + L2
        │    → align → embed → match               ▼
        │                                    is_match verdict
        ▼
  best candidate below threshold  ──or──  NO MATCH FOUND (terminates honestly)
        │
        ▼
  canonical JSON  (sorted keys, compact separators)
        │
        │  generate_canonical_hash()   SHA-256
        ▼
  0x…64 hex  (bytes32)
        │
        │  recordVerification(bytes32)
        ▼
  on-chain: {recordHash, block.timestamp, msg.sender}
        │
        │  getVerification(bytes32)
        ▼
  read back → re-hash the record → compare → VERIFIED / TAMPERED
```

---

## 2. Repository layout

```
Tales of Goa/
├── backend/                        Python 3.11 · FastAPI · OpenCV · web3
│   ├── app/
│   │   ├── main.py                 FastAPI app, CORS, router registration
│   │   ├── routes/
│   │   │   ├── face.py             /api/face/detect · /encode · /compare
│   │   │   ├── social.py           /api/social/search-and-verify · /capabilities · /fetch
│   │   │   └── verification.py     /api/verification/status · /record · /query
│   │   ├── schemas/
│   │   │   └── face.py             Pydantic request/response models
│   │   └── services/
│   │       ├── face_processor.py   ★ detection, alignment, embedding, matching
│   │       ├── face_search.py      ★ genuine discovery + candidate verification
│   │       ├── social_search.py    pipeline orchestration, query-based sources
│   │       ├── hashing.py          canonical JSON → SHA-256
│   │       ├── blockchain.py       web3 commit / query / chain status
│   │       ├── face_detection_yunet_2023mar.onnx      227 KB
│   │       └── face_recognition_sface_2021dec.onnx     37 MB
│   ├── tests/
│   │   ├── test_recognition.py     ★ positive/negative acceptance tests
│   │   ├── test_pipeline.py        unit tests
│   │   └── fixtures/               your photos (gitignored)
│   ├── run.py                      starts uvicorn on :8000
│   ├── run_pipeline.py             ★ CLI end-to-end pipeline
│   ├── verify_chain.py             ★ CLI blockchain operations
│   ├── requirements.txt
│   └── .env                        config for BOTH backend and Hardhat (gitignored)
│
├── blockchain/                     Hardhat 2 · Solidity 0.8.20
│   ├── contracts/
│   │   ├── FaceVerification.sol    ★ the verification contract
│   │   └── SampleContract.sol      unused scaffold
│   ├── scripts/
│   │   ├── deploy.js               deploy + preflight balance check
│   │   └── balance.js              RPC/key/gas preflight
│   ├── test/FaceVerification.test.js
│   └── hardhat.config.js           reads ../backend/.env
│
├── frontend/                       Next.js 16 · React 19 (OPTIONAL)
│   ├── src/app/                    page.tsx · layout.tsx · globals.css
│   ├── src/components/             10 components
│   ├── src/services/api.ts         typed API client
│   └── public/landing-pages/       Sylva 3D hero scene
│
└── docs/                           this documentation
```

★ = the modules that carry the task's substance.

---

## 3. Stage 1 — face detection

**`backend/app/services/face_processor.py` → `detect_faces_detailed()`**

Uses **YuNet** (`cv2.FaceDetectorYN`), a small CNN from the OpenCV Zoo.

```python
_DETECTOR = cv2.FaceDetectorYN.create(
    "face_detection_yunet_2023mar.onnx", "",
    (320, 320),          # input size, re-declared per image
    0.6,                 # YUNET_SCORE_THRESHOLD
    0.3,                 # YUNET_NMS_THRESHOLD
    5000,                # YUNET_TOP_K
)
```

### What it returns

Per face, a `FaceDetection` dataclass:

| Field | Meaning |
|---|---|
| `box` | `{top, right, bottom, left}` in **original image coordinates** |
| `score` | Confidence, 0–1 (typically 0.90–0.95 on a clear face) |
| `landmarks` | 5 points: right eye, left eye, nose, right mouth, left mouth |
| `raw` | YuNet's 15-value row — **required verbatim by `alignCrop`** |

Detections are sorted largest-area first, so `detections[0]` is the primary face.

### Large-image handling

```python
max_side = 1024
scale = min(1.0, max_side / max(width, height))
```

Images larger than 1024px on their long edge are downscaled **for detection
only**. Boxes and landmarks are mapped back by `1/scale`, so the crop is always
taken from the original pixels. A 2437×3000 photo detects correctly and still
produces a full-resolution aligned crop.

### Why not Haar

The original build used `haarcascade_frontalface_default` + `_alt2`, with a
third fallback that took the **largest skin-coloured HSV blob** with an aspect
ratio between 0.7 and 2.5 and called it a face. On a warm-toned photo that
returns an arm, a neck, or a wall — the "square that isn't my face". Haar is
also strictly frontal and brittle under lighting change.

YuNet gives higher recall, tolerates moderate pose, and — decisively — returns
the **landmarks** that the recogniser needs.

### No fallback by design

If the model is missing, `detect_faces_detailed()` raises `ModelUnavailable`.
There is no degraded path. A recogniser that cannot recognise anyone is worse
than an explicit failure.

---

## 4. Stage 2 — alignment and embedding

**`align_face()` → `encode_aligned_face()` → `feature_to_list()`**

```python
aligned  = _RECOGNIZER.alignCrop(image_bgr, detection.raw)   # 112×112
feature  = _RECOGNIZER.feature(aligned)                      # 1×128 float32
```

### Why alignment is the whole ballgame

SFace is trained on faces **warped to a canonical position** using the five
landmarks — eyes on a fixed horizontal line, nose and mouth at fixed offsets.
`alignCrop` performs that similarity transform.

The original code did this instead:

```python
aligned_face = cv2.resize(face_bgr, (112, 112))   # variable named "aligned"
feature = _SFACE_RECOGNIZER.feature(aligned_face) #   …but never aligned
```

A loosely padded detector box, plain-resized. The model still runs and still
emits 128 numbers, so nothing looks broken — but the numbers carry far less
identity. Measured on the same pair of photographs:

| | cosine | verdict |
|---|---|---|
| Plain `resize(112,112)` | **0.175** | rejected — false mismatch |
| `alignCrop()` with landmarks | **0.6415** | correct match |

One function call, a 3.7× improvement in the identity signal. This single defect
was the cause of the reported "17.5% mismatch on two photos of myself".

### Normalisation

`feature_to_list()` L2-normalises the raw feature to a unit vector before
storage. This is safe: `SFace.match()` normalises internally for **both**
metrics, so cosine and L2 are unchanged by pre-normalising — and the stored
record becomes scale-independent.

### One entry point

```python
embed_primary_face(image_bgr) -> {
    detection, detections, aligned, feature,
    embedding, display_crop, image_width, image_height, face_count
}
```

**Every** path calls this: the live webcam frame, the uploaded photo, and each
downloaded candidate image. That is what makes "the same person photographed
twice" comparable — there is exactly one preprocessing chain, not two.

`crop_face_region()` still exists but is **display only** (the padded thumbnail
shown in the UI). It never feeds the recogniser.

---

## 5. Stage 3 — matching and thresholds

**`match_features()` / `evaluate_face_similarity()`**

```python
cosine = _RECOGNIZER.match(a, b, FR_COSINE)
l2     = _RECOGNIZER.match(a, b, FR_NORM_L2)
```

Uses SFace's own `match()` rather than hand-rolled arithmetic, exactly as
OpenCV's reference demo does.

### The operating point

| Metric | Match when | Source |
|---|---|---|
| Cosine similarity | **≥ 0.363** | OpenCV Zoo `sface.py` |
| Euclidean L2 | **≤ 1.128** | OpenCV Zoo `sface.py` |

These are **one boundary, not two**. For unit vectors:

```
L2 = √(2 · (1 − cos))
√(2 · (1 − 0.363)) = 1.1287
```

So a report of `cosine 0.175, L2 1.2845` is internally consistent — the metrics
were never the bug.

### Measured separation

| Case | cosine | L2 |
|---|---|---|
| Same person, 16 months apart | +0.6415 | 0.8467 |
| Same person, 10 live-found photos | +0.48 … +0.67 | 0.82 … 1.02 |
| Different people | +0.1305 | 1.3187 |
| Different people, 11 live-found photos | 0.00 … +0.18 | 1.28 … 1.41 |

The threshold at 1.128 sits in a clean gap. It was **not** tuned to make any
particular photo pass.

### Similarity percentage

Raw `cosine × 100` was misleading — a genuine match at the 0.363 boundary read
as "36%", which looks like failure. `similarity_percentage()` maps cosine onto
0–100 with the decision threshold pinned at exactly **50%**:

| cosine | reported | verdict |
|---|---|---|
| +1.000 | 100.00% | match |
| +0.800 | 84.30% | match |
| +0.500 | 60.75% | match |
| **+0.363** | **50.00%** | **boundary** |
| +0.200 | 44.02% | non-match |
| 0.000 | 36.68% | non-match |

The verdict is always driven by the L2 threshold, never by this display number.

---

## 6. Stage 4 — genuine web/social discovery

**`backend/app/services/face_search.py`**

The task requires *"a genuine search step, not a hardcoded/pre-picked result"*.
This module exists to enforce that. **There is no candidate list in it.**

### Two layers

#### Layer 1 — reverse image search (true face → web)

Sends the actual face image to a visual-search provider. This is the only
mechanism that can identify an unknown person from a photo alone.

```python
POST https://api.bing.microsoft.com/v7.0/images/visualsearch
     files={"image": (…, image_bytes, "image/jpeg")}
```

Bing accepts the **binary**, so it works on a local photo. SerpAPI's Google Lens
requires a publicly reachable image URL and is therefore skipped for local
scans, with a logged reason rather than a silent no-op.

Requires an API key. Optional.

#### Layer 2 — live scripted search (text-seeded, face-gated)

No key needed. Two live queries per run:

```python
DDGS().images(query, max_results=12)          # → candidate images
DDGS().text(f"{query} (site:github.com OR site:x.com OR …)")
      → fetch each page → read og:image / twitter:image
```

Candidates are de-duplicated by image URL and capped at `MAX_CANDIDATES = 12`.

**Honest framing:** discovery here is seeded by a text hint, and the *face check*
decides the outcome. It is a "scripted search approach", which the task permits,
but it is weaker than true reverse-image search and the docs say so.

### Capability reporting

```python
search_capabilities() -> {
  "reverse_image_search": "Bing Visual Search" | "SerpAPI (Google Lens)" | None,
  "reverse_image_available": bool,
  "live_search_available": bool,          # is `ddgs` importable
  "live_search_engine": "DuckDuckGo (ddgs)" | None,
  "mode": "reverse_image" | "live_scripted" | "unavailable",
}
```

Surfaced at `GET /api/social/capabilities` and printed by `run_pipeline.py`, so
the operator always knows which mechanism actually ran.

---

## 7. Stage 5 — candidate verification

**`verify_candidate()`** — the stage that decides the outcome.

For each candidate:

1. Download the image (12 s timeout, follow redirects, reject < 400 bytes)
2. Apply EXIF orientation, convert to BGR
3. `detect_faces_detailed()` — find **every** face, not just the first
4. For up to `MAX_FACES_PER_CANDIDATE = 6` faces: align, embed, compare
5. Keep the **best** (lowest L2) score for that candidate
6. Record `faces_found`, `best_cosine`, `best_l2`, `is_match`, or an `error`

A candidate with no detectable face is **rejected outright** — it cannot
corroborate an identity.

### Selection

```python
passing = [c for c in verified if c.is_match]
passing.sort(key=lambda c: c.best_l2)
best_match = passing[0] if passing else None
```

If `best_match is None`, `run_social_search_and_verification_pipeline` raises
`NoMatchFound` carrying the full audit. Nothing downstream runs.

### The audit trail

Every candidate — passing or not — appears in `candidate_report`:

```json
{
  "page_url": "…", "image_url": "…", "source": "live:ddg_images",
  "faces_found": 1, "cosine_similarity": 0.6075,
  "euclidean_distance": 0.886, "similarity_percentage": 69.2,
  "is_match": true, "error": null
}
```

This is what makes the search auditable rather than a black box. Live example —
input face plus the hint *"Bill Gates"*:

```
L2=1.3926  faces=1  rejected  https://wallpapers.com/…bill-gates-in-suit…
L2=1.4036  faces=1  rejected  https://wallpapers.com/…bill-gates-portrait…
L2=1.4267  faces=1  rejected  https://www.gatesfoundation.org/…
…
[NO MATCH] nothing passed the threshold (closest L2=1.3926)
```

The search genuinely found Bill Gates. The face check rejected every result.
That is the proof the pipeline is not returning pre-picked answers.

---

## 8. Stage 6 — canonical record and fingerprint

**`backend/app/services/hashing.py`**

```python
canonical_json = json.dumps(record, sort_keys=True, separators=(',', ':'))
sha256 = hashlib.sha256(canonical_json.encode('utf-8')).hexdigest()
```

`sort_keys=True` and compact separators make serialisation **deterministic** —
the same record always produces the same 64-hex digest, regardless of dict
insertion order or platform.

### What gets hashed

```json
{
  "pipeline": "HH_GOA_2026_TASK_3",
  "record_type": "WEB_SOCIAL_FACE_VERIFICATION",
  "discovered_post": {
    "url": "https://www.the-sun.com/sport/14521551/…",
    "platform": "www.the-sun.com",
    "author": "…",
    "title": "…",
    "description": "…",
    "image_url": "https://…jpg"
  },
  "verification_metrics": {
    "similarity_percentage": 69.2,
    "euclidean_distance": 0.886,
    "cosine_similarity": 0.6075,
    "threshold_used": 1.128,
    "is_match": true
  },
  "models": {
    "detector": "YuNet (face_detection_yunet_2023mar.onnx)",
    "recognizer": "SFace (face_recognition_sface_2021dec.onnx)"
  },
  "discovered_at": "2026-09-05T19:15:22.000000+00:00"
}
```

### Privacy

**No image and no embedding ever goes on-chain.** Only the 32-byte digest. The
contract's own comment states this. Verification therefore proves a record has
not been altered; it does not publish the record's contents.

---

## 9. Stage 7 — blockchain commit and re-verification

**`backend/app/services/blockchain.py`**

### Transaction construction

| Concern | Handling |
|---|---|
| Fees | EIP-1559 when `baseFeePerGas` exists: `maxFee = 2×base + priority`. Legacy `gasPrice` otherwise |
| Gas | `estimate_gas() × 1.25`, falling back to 120,000. Observed actual: **90,265** |
| Nonce | `get_transaction_count(address, "pending")` |
| PoA chains | `ExtraDataToPOAMiddleware` injected — Sepolia's oversized `extraData` fails the default validator |
| RPC timeout | **20 s** (a public endpoint is far slower than localhost) |
| Receipt wait | **240 s** (a Sepolia block lands every ~12 s) |

The original values were `timeout: 1` and `receipt: 10` — with those, a public
testnet could **never** succeed and every run silently fell through to the
simulator.

### Honest simulation

If the contract address, key, or RPC is unavailable, `_simulated_result()`
returns a clearly flagged dry run:

```json
{
  "success": true, "simulated": true, "status": "simulated",
  "transaction_hash": "0x…",  
  "network": "Local Hardhat Node (SIMULATED - not broadcast)",
  "block_number": null,
  "error": "CONTRACT_ADDRESS is not set in backend/.env — deploy the contract first."
}
```

The original returned a `sha256(hash + time)` string labelled `"confirmed"` with
a hardcoded `block_number: 1048291` — indistinguishable from a real transaction
in the UI. Now the UI renders simulated proofs in amber as
**"SIMULATED PROOF — NOT BROADCAST ON-CHAIN"**.

### Tamper check

```python
recomputed = "0x" + generate_canonical_hash(canonical_record)
tamper_check = {
    "recomputed_hash": recomputed,
    "stored_hash": bytes32_record_hash,
    "hashes_identical": recomputed == bytes32_record_hash,
    "found_on_chain": onchain["exists_on_chain"],
    "verdict": "VERIFIED" | "UNVERIFIED" | "TAMPERED",
}
```

See [BLOCKCHAIN.md](BLOCKCHAIN.md) for the contract itself.

---

## 10. Frontend

Optional. Next.js 16 App Router, React 19, TypeScript.

| Component | Responsibility |
|---|---|
| `page.tsx` | Masthead, live backend + chain status, three tabs |
| `SocialDiscoveryPipeline.tsx` | Tab 01 — upload → discovery → on-chain proof |
| `FaceComparisonView.tsx` | Tab 02 — 1-to-1 comparison, auto-commit on match |
| `CameraView.tsx` | Webcam capture, samples a frame every 250 ms |
| `FaceOverlay.tsx` | Draws detection boxes over image or video |
| `EmbeddingPanel.tsx` | 128-D vector, record hash, chain result |
| `PixelInspectionPanel.tsx` | RGB / grayscale / equalised crop previews |
| `SylvaHeroBackground.tsx` | Three.js hero scene with GPU-tier scaling |

### Two frontend bugs worth recording

**Overlay geometry.** `FaceComparisonView` hardcoded `imageWidth={640}
imageHeight={480}` while photos are commonly 1280×720, so boxes were scaled ~2×
and pushed off the right edge as a sliver. Separately, `FaceOverlay` scaled by
`containerW/imageW` and `containerH/imageH` **independently**, ignoring the
letterboxing that `object-fit: contain` introduces.

`FaceOverlay` now measures its own box with a `ResizeObserver` and applies
correct uniform-scale-plus-offset geometry for `contain`, `cover` and `fill`, so
no caller can get it wrong again.

**Capture cost.** The webcam loop JPEG-encoded a full 1280×720 frame on the main
thread four times a second. It now downscales to 640 px wide at quality 0.7
first — roughly 4× less encode and payload, with no detection loss.

---

## 11. Design rules the code enforces

1. **No fabricated identity.** If discovery finds nothing, the answer is
   `NoMatchFound`. There is no fallback candidate anywhere in the codebase.
2. **No silent degradation.** A missing model raises. It does not fall back to a
   weaker embedding that cannot recognise anyone.
3. **One preprocessing path.** Live frames, uploads and downloaded candidates all
   go through `embed_primary_face()`.
4. **Thresholds are published constants**, validated with positive *and* negative
   pairs. They are not tuned per photo.
5. **Simulated is never shown as confirmed.** `simulated: true` propagates to the
   API and renders distinctly in the UI.
6. **Every candidate is auditable.** Scores for accepted *and* rejected
   candidates are returned and printed.
7. **Only hashes go on-chain.** No images, no embeddings, no personal data.

---

## 12. Audit history — what was wrong before

Recorded because the fixes are the substance of this project.

| # | Defect | Impact | Fix |
|---|---|---|---|
| 1 | `resize(112,112)` instead of `alignCrop()` | Same person scored cosine **0.175** → false mismatches | Landmark alignment → **0.6415** |
| 2 | `AUTONOMOUS_CANDIDATE_POOL` — 5 hardcoded people (a collaborator's GitHub, Torvalds, Rauchg, **Guido van Rossum**, Musk) | "Discovery" returned the nearest of 5 strangers. Source of the Guido result | **Deleted.** Replaced with live search + mandatory face gate |
| 3 | Query path had **no face gating** | Resolved a name → displayed that profile → reported MISMATCH beside it | Every path now gated on the biometric check |
| 4 | HSV skin-blob detection fallback | Returned arms/walls as "faces" | Removed; YuNet only |
| 5 | `ddgs` imported but never installed | The only genuine search was dead code inside `except` | Installed and pinned in `requirements.txt` |
| 6 | Simulator returned fake tx hashes labelled `"confirmed"` | Looked identical to a real transaction | `simulated: true` + amber UI treatment |
| 7 | RPC timeout 1 s, receipt wait 10 s | A public testnet could never succeed | 20 s / 240 s |
| 8 | Compare threshold defaulted to 0.60 | Rejected genuine matches at L2 0.85 | 1.128, SFace's published point |
| 9 | EXIF orientation discarded by `.convert('RGB')` | Portrait photos arrived sideways; detection failed | `ImageOps.exif_transpose()` before conversion |
| 10 | Overlay hardcoded 640×480, non-uniform scaling | Boxes landed off the face — the "square" complaint | Self-measuring overlay with object-fit geometry |
| 11 | Flaky contract test predicted `latest + 1` timestamp | Raced the node clock | Matches loosely, pins against the receipt's block |

Docstring irony worth noting: `social_search.py` claimed
*"Never returns hardcoded or fake fallbacks"* on line 69 — 150 lines above the
hardcoded pool.

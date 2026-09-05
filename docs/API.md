# HTTP API Reference

FastAPI backend, base URL `http://localhost:8000`.
Interactive Swagger docs: **<http://localhost:8000/docs>**

All examples below are **real captured responses**, truncated where noted.

---

## Contents

- [Conventions](#conventions)
- [`GET /` — service info](#get--service-info)
- [`POST /api/face/detect`](#post-apifacedetect)
- [`POST /api/face/encode`](#post-apifaceencode)
- [`POST /api/face/compare`](#post-apifacecompare)
- [`POST /api/social/search-and-verify`](#post-apisocialsearch-and-verify)
- [`GET /api/social/capabilities`](#get-apisocialcapabilities)
- [`POST /api/social/fetch`](#post-apisocialfetch)
- [`GET /api/verification/status`](#get-apiverificationstatus)
- [`POST /api/verification/record`](#post-apiverificationrecord)
- [`GET /api/verification/query/{hash}`](#get-apiverificationqueryrecord_hash)
- [Error semantics](#error-semantics)
- [curl recipes](#curl-recipes)

---

## Conventions

**Images** are base64 strings, with or without a data-URL prefix:

```
data:image/jpeg;base64,/9j/4AAQSkZJRg…
```

EXIF orientation is applied on decode, so phone/camera photos are handled
upright.

**Thresholds** are always an **L2 distance**. Default `1.128` — SFace's
published operating point. Lower is stricter.

**CORS** is open (`allow_origins=["*"]`) for local development.

**Timeouts** — discovery endpoints hit the live network and can take 20–60 s.
Set generous client timeouts.

---

## `GET /` — service info

Liveness probe. The frontend polls this every 3 s.

```json
{
  "service": "HH GOA Face ID & 1-to-1 Verification Backend API",
  "status": "online",
  "version": "2.0.0",
  "pipeline": ["LIVE_CAMERA_FRAME", "REFERENCE_SOCIAL_IMAGE",
               "OPENCV_FACE_DETECTION", "FACE_CROPPING",
               "128D_NUMERICAL_EMBEDDINGS", "EUCLIDEAN_COSINE_SIMILARITY",
               "CANONICAL_SHA256_HASH", "WEB3_SOLIDITY_SMART_CONTRACT"]
}
```

---

## `POST /api/face/detect`

Detect faces and return boxes plus pixel diagnostics. Does **not** embed.

### Request

```json
{ "image": "data:image/jpeg;base64,…" }
```

### Response (real, truncated)

```json
{
  "face_detected": true,
  "face_count": 1,
  "faces": [ { "top": 258, "right": 747, "bottom": 535, "left": 534 } ],
  "status_message": "FACE DETECTED",
  "image_width": 1280,
  "image_height": 720,
  "pixel_stats": {
    "image_width": 1280,
    "image_height": 720,
    "total_pixels": 921600,
    "channels": 3,
    "total_bytes": 2764800,
    "face_crop_width": 275,
    "face_crop_height": 359,
    "face_crop_pixels": 98725,
    "standardized_grid_pixels": 12544,
    "sample_pixels": [
      { "coordinate": "(0, 0)", "rgb": "RGB(114, 102, 90)",
        "bgr": "BGR(90, 102, 114)", "grayscale": 104, "hex": "#72665A" }
    ]
  },
  "rgb_crop_base64": "data:image/jpeg;base64,…",
  "grayscale_crop_base64": "data:image/jpeg;base64,…",
  "equalized_crop_base64": "data:image/jpeg;base64,…",
  "error": null
}
```

### Notes

- Boxes are in **original image coordinates**. A 2437×3000 photo returns boxes
  in that space — do not assume 640×480.
- `standardized_grid_pixels` is `112 × 112 = 12544`, the aligned crop SFace
  actually consumes.
- The three crop images are **display previews only**. The embedding is computed
  from the aligned colour crop, never from the grayscale preview.
- Multiple faces are returned largest-area first.

---

## `POST /api/face/encode`

Detect → align → embed → canonical record → SHA-256.

### Request

```json
{ "image": "data:image/jpeg;base64,…" }
```

### Response (real, truncated)

```json
{
  "success": true,
  "embedding_dimension": 128,
  "embedding": [-0.120964, 0.03469, -0.125334, 0.081299, "…124 more"],
  "record_hash": "df78dd61ca015f44d33d9007390e7e9b3938bf54821ae0fcdc2370669efb55d3",
  "pixel_stats": { "…": "…" },
  "rgb_crop_base64": "…",
  "grayscale_crop_base64": "…",
  "equalized_crop_base64": "…",
  "error": null
}
```

`record_hash` is a bare 64-hex digest (no `0x`). Prefix it when passing to the
contract; `format_bytes32_hash()` does this for you.

---

## `POST /api/face/compare`

1-to-1 verification. Both images traverse the **identical** detect → align →
embed path.

### Request

```json
{
  "image_a": "data:image/jpeg;base64,…",
  "image_b": "data:image/jpeg;base64,…",
  "threshold": 1.128,
  "auto_record_on_chain": false
}
```

| Field | Type | Default | Notes |
|---|---|---|---|
| `image_a` | string | — | Live frame or upload |
| `image_b` | string | — | Reference image |
| `threshold` | float | `1.128` | L2. **Do not widen to force a match** |
| `auto_record_on_chain` | bool | `false` | Commit the comparison record when matched |

### Response (key fields)

```json
{
  "success": true,
  "is_match": true,
  "similarity_percentage": 71.86,
  "euclidean_distance": 0.8467,
  "cosine_similarity": 0.6415,
  "threshold_used": 1.128,
  "status_message": "MATCH VERIFIED",
  "face_a_detected": true,
  "face_b_detected": true,
  "face_a_box": { "top": 216, "right": 761, "bottom": 498, "left": 541 },
  "face_b_box": { "top": 258, "right": 747, "bottom": 535, "left": 534 },
  "embedding_a": ["…128 floats"],
  "embedding_b": ["…128 floats"],
  "record_hash": "5c384934205ae791e1c1d1fdc7ff563d0deb0e4e7b59baa399862f8ea45f4b2b",
  "canonical_record": { "…": "…" },
  "blockchain_result": { "…": "…" },
  "pixel_stats_a": { "…": "…" },
  "rgb_crop_a_base64": "…",
  "error": null
}
```

### Verified reference values

| Pair | cosine | L2 | `is_match` |
|---|---|---|---|
| Same person, 16 months apart | +0.6415 | 0.8467 | `true` |
| Two different people | +0.1305 | 1.3187 | `false` |

The backend also logs a per-image diagnostic line:

```
[COMPARE] A: {'source': 'image_a', 'image_width': 1280, 'image_height': 720,
              'faces_detected': 1, 'detection_score': 0.9498,
              'aligned_crop_size': [112, 112],
              'detector_model': 'YuNet (…)', 'recognizer_model': 'SFace (…)'}
```

---

## `POST /api/social/search-and-verify`

**The Task 3 endpoint.** Face scan → genuine search → verification → SHA-256 →
blockchain → re-verify.

### Request

```json
{
  "image": "data:image/jpeg;base64,…",
  "query": "Serena Williams",
  "threshold": 1.128
}
```

| Field | Type | Default | Notes |
|---|---|---|---|
| `image` | string | — | The input face scan |
| `query` | string | `""` | Search hint. **Omit for pure face-driven discovery** (needs a reverse-image key) |
| `threshold` | float | `1.128` | L2 |

### Response — match found (`200`)

```json
{
  "success": true,
  "pipeline_stage": "COMPLETE",
  "input_face": {
    "crop_base64": "data:image/jpeg;base64,…",
    "image_width": 2437, "image_height": 3000
  },
  "discovered_post": {
    "url": "https://www.the-sun.com/sport/14521551/serena-williams-tennis-legend/",
    "platform": "www.the-sun.com",
    "author": "Serena Williams turns heads as tennis legend shows off…",
    "title": "…", "description": "…",
    "image_url": "https://www.the-sun.com/wp-content/uploads/…jpg",
    "post_face_crop_base64": "data:image/jpeg;base64,…"
  },
  "metrics": {
    "similarity_percentage": 69.2,
    "euclidean_distance": 0.886,
    "cosine_similarity": 0.6075,
    "is_match": true
  },
  "record_hash": "0x6ed3dc8c3ee3a1feb27da5eea3700147e3a487acdc93dc26e19fd239c606a84e",
  "canonical_record": { "…": "…" },
  "blockchain_upload": {
    "success": true, "simulated": false,
    "transaction_hash": "0xd9bd538e29a62104bacf7b301ff43d5cbb145e567392c9c48c626c0d581f6cbe",
    "network": "Local Hardhat Node", "chain_id": 31337,
    "status": "confirmed", "block_number": 8, "gas_used": 90265,
    "explorer_url": null, "error": null
  },
  "onchain_reverification": {
    "record_hash": "0x6ed3dc8c…", "exists_on_chain": true,
    "timestamp": 1788635722, "timestamp_iso": "2026-09-05T19:15:22+00:00",
    "recorder": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
    "network": "Local Hardhat Node", "chain_id": 31337
  },
  "tamper_check": {
    "recomputed_hash": "0x6ed3dc8c…", "stored_hash": "0x6ed3dc8c…",
    "hashes_identical": true, "found_on_chain": true,
    "simulated": false, "verdict": "VERIFIED"
  },
  "diagnostics": {
    "input_scan": {
      "source": "input_scan", "image_width": 2437, "image_height": 3000,
      "faces_detected": 1, "detection_score": 0.9134,
      "landmarks": [[1050,1180],[1420,1195],[1240,1490],[1080,1720],[1400,1735]],
      "aligned_crop_size": [112, 112],
      "detector_model": "YuNet (face_detection_yunet_2023mar.onnx)",
      "recognizer_model": "SFace (face_recognition_sface_2021dec.onnx)",
      "embedding_dimension": 128, "normalization": "L2 unit norm"
    },
    "search": {
      "mechanisms": ["DuckDuckGo (ddgs) (text-seeded, face-gated)"],
      "capabilities": { "…": "…" },
      "candidates_considered": 12,
      "candidates_verified": 12,
      "threshold_l2": 1.128,
      "candidate_report": [
        { "page_url": "…", "image_url": "…", "source": "live:ddg_images",
          "faces_found": 1, "cosine_similarity": 0.6075,
          "euclidean_distance": 0.886, "similarity_percentage": 69.2,
          "is_match": true, "error": null }
      ]
    }
  }
}
```

### Response — no match found (also `200`)

A genuine empty result is **not an error**.

```json
{
  "success": true,
  "match_found": false,
  "pipeline_stage": "NO_MATCH",
  "message": "No matching public social media post found. No reverse-image provider is configured, so a face alone cannot be searched against the web. Set REVERSE_IMAGE_PROVIDER + an API key for true face-driven discovery, or supply a search hint to use the live face-gated search.",
  "diagnostics": {
    "search": {
      "mechanisms": [],
      "candidates_considered": 0,
      "candidates_verified": 0,
      "threshold_l2": 1.128,
      "candidate_report": []
    }
  }
}
```

**Clients must branch on `match_found === false`.** No `discovered_post`,
`metrics` or `record_hash` is present, and none is invented.

### Interpreting `candidate_report`

Real run — input face plus the hint *"Bill Gates"*:

| L2 | faces | verdict | image |
|---|---|---|---|
| 1.3926 | 1 | rejected | wallpapers.com/…bill-gates-in-suit… |
| 1.4036 | 1 | rejected | wallpapers.com/…bill-gates-portrait… |
| 1.4267 | 1 | rejected | gatesfoundation.org/… |
| 1.4561 | 1 | rejected | media.ambito.com/… |

The search genuinely found Bill Gates; the face check rejected all of them.
Result: `match_found: false`.

---

## `GET /api/social/capabilities`

Which models and which search mechanism are live **right now**.

```json
{
  "models": {
    "detector": "YuNet (face_detection_yunet_2023mar.onnx)",
    "recognizer": "SFace (face_recognition_sface_2021dec.onnx)",
    "detector_loaded": true,
    "recognizer_loaded": true,
    "embedding_dimension": 128,
    "normalization": "L2 unit norm",
    "cosine_threshold": 0.363,
    "l2_threshold": 1.128
  },
  "search": {
    "reverse_image_search": null,
    "reverse_image_available": false,
    "live_search_available": true,
    "live_search_engine": "DuckDuckGo (ddgs)",
    "mode": "live_scripted"
  }
}
```

`mode` is one of `reverse_image`, `live_scripted`, `unavailable`.

---

## `POST /api/social/fetch`

Fetch OpenGraph metadata and image for a URL. Utility; not part of the
verification path.

```json
{ "url": "https://github.com/torvalds" }
```

```json
{
  "success": true,
  "post_url": "https://github.com/torvalds",
  "platform": "GitHub",
  "author": "torvalds",
  "title": "…", "description": "…",
  "image_url": "https://avatars.githubusercontent.com/u/1024025?v=4",
  "image_base64": "data:image/jpeg;base64,…"
}
```

`404` if no image can be extracted.

---

## `GET /api/verification/status`

Chain diagnostics. Drives the UI network badge.

```json
{
  "chain_id": 31337,
  "network": "Local Hardhat Node",
  "rpc_url": "http://127.0.0.1:8545",
  "contract_address": "0x5FbDB2315678afecb367f032d93F642f64180aa3",
  "explorer_url": null,
  "configured": true,
  "connected": true,
  "live": true,
  "account": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  "balance_eth": 9999.999,
  "block_number": 9,
  "message": "Connected to Local Hardhat Node."
}
```

| Field | Meaning |
|---|---|
| `configured` | Contract address **and** private key are both set |
| `connected` | The RPC endpoint answered |
| `live` | Connected **and** configured **and** the account holds gas |

`live: false` means writes will be simulated. `message` says why.

On Sepolia, `explorer_url` becomes
`https://sepolia.etherscan.io/address/0x…`.

---

## `POST /api/verification/record`

Commit an arbitrary 32-byte hash.

```json
{ "record_hash": "0xc891a6dd0c216d64299fac759bddefa2c6105fc48388d0691f64b9225952a334" }
```

Accepts with or without `0x`; short values are zero-padded to 64 hex.

```json
{
  "success": true, "simulated": false,
  "record_hash": "0xc891a6dd…",
  "transaction_hash": "0x83abe568…",
  "network": "Local Hardhat Node", "chain_id": 31337,
  "status": "confirmed", "block_number": 7, "gas_used": 90265,
  "explorer_url": null,
  "timestamp": "2026-09-05T19:14:48.123456+00:00",
  "error": null
}
```

`status` is one of `confirmed`, `reverted`, `simulated`, `failed`.

> **Always check `simulated`.** A simulated result carries a plausible-looking
> `transaction_hash` that was never broadcast, with the reason in `error`.

---

## `GET /api/verification/query/{record_hash}`

Read a record back from the contract.

```
GET /api/verification/query/0xc891a6dd0c216d64299fac759bddefa2c6105fc48388d0691f64b9225952a334
```

**Found:**

```json
{
  "record_hash": "0xc891a6dd…", "exists_on_chain": true,
  "timestamp": 1788635868, "timestamp_iso": "2026-09-05T19:17:48+00:00",
  "recorder": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  "network": "Local Hardhat Node", "chain_id": 31337,
  "simulated": false, "explorer_url": null
}
```

**Not found** — also `200`; absence is a legitimate answer and the basis of
tamper detection:

```json
{
  "record_hash": "0x1111…", "exists_on_chain": false,
  "network": "Local Hardhat Node", "chain_id": 31337,
  "simulated": false,
  "error": "Record hash not found on-chain."
}
```

---

## Error semantics

| Status | Meaning |
|---|---|
| `200` + `match_found: false` | Genuine empty search result. **Not an error** |
| `200` + `exists_on_chain: false` | Hash absent — how tampering is detected |
| `200` + `simulated: true` | Ran, but was **not** broadcast. Read `error` |
| `400` | Bad input — no face detected, malformed base64 |
| `404` | `/api/social/fetch` could not extract an image |
| `500` | Unexpected failure |

Two failure modes are deliberately **not** errors: "the search found nobody" and
"that hash is not on the chain". Both are meaningful results.

---

## curl recipes

```bash
# Health
curl -s http://localhost:8000/ | python -m json.tool

# What is live right now
curl -s http://localhost:8000/api/social/capabilities | python -m json.tool

# Chain status
curl -s http://localhost:8000/api/verification/status | python -m json.tool

# Detect (build the payload with a helper so base64 stays out of the shell)
python - <<'PY'
import base64, json, urllib.request
img = "data:image/jpeg;base64," + base64.b64encode(open("face.jpg","rb").read()).decode()
req = urllib.request.Request("http://localhost:8000/api/face/detect",
        data=json.dumps({"image": img}).encode(),
        headers={"Content-Type": "application/json"})
r = json.load(urllib.request.urlopen(req, timeout=120))
print(r["face_detected"], r["face_count"], r["faces"])
PY

# Compare two images
python - <<'PY'
import base64, json, urllib.request
b = lambda p: "data:image/jpeg;base64," + base64.b64encode(open(p,"rb").read()).decode()
req = urllib.request.Request("http://localhost:8000/api/face/compare",
        data=json.dumps({"image_a": b("a.jpg"), "image_b": b("b.jpg")}).encode(),
        headers={"Content-Type": "application/json"})
r = json.load(urllib.request.urlopen(req, timeout=300))
print(f"cosine {r['cosine_similarity']:+.4f}  L2 {r['euclidean_distance']:.4f}  match {r['is_match']}")
PY

# Query a hash
curl -s http://localhost:8000/api/verification/query/0xc891a6dd0c216d64299fac759bddefa2c6105fc48388d0691f64b9225952a334 | python -m json.tool
```

For the full pipeline prefer the CLI — see
[OPERATIONS.md](OPERATIONS.md#5-terminal-only-operation-no-gui).

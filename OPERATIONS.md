# Tales of Goa — Operations Manual

**HH Goa 2026 Shortlisting Task #3 — Face Identification & Blockchain Verification**

Everything needed to run, demonstrate and submit this project. The whole
pipeline runs from the terminal; the web UI is optional.

---

## Contents

1. [The task](#1-the-task)
2. [What this project does](#2-what-this-project-does)
3. [API keys — what exists, what is required](#3-api-keys--what-exists-what-is-required)
4. [First-time setup](#4-first-time-setup)
5. [Terminal-only operation (no GUI)](#5-terminal-only-operation-no-gui)
6. [Blockchain operations by terminal](#6-blockchain-operations-by-terminal)
7. [Acceptance tests](#7-acceptance-tests)
8. [Optional: the web UI](#8-optional-the-web-ui)
9. [Screen-recording script](#9-screen-recording-script)
10. [Troubleshooting](#10-troubleshooting)
11. [Known limitations](#11-known-limitations)

---

## 1. The task

Reproduced from `docs/task/task #3.txt`.

> ### HH Goa 2026 Shortlisting Task 3: Face Identification & Blockchain Verification
>
> **What to build**
>
> A pipeline that takes a face scan as input, identifies matching content on the
> web/social media, and then verifies that discovered data using a blockchain —
> end to end.
>
> **Pipeline shape:** Face scan input → Web/social media search (find matching
> post) → Blockchain upload/verification of the discovered data
>
> **Technical requirements**
>
> 1. **Face identification** — Detect and encode a face from an input image (any
>    face detection/recognition library or API is acceptable).
> 2. **Social media / web search** — Use the face to search the web and find at
>    least one real, matching social media post (via reverse image search, an
>    API, or a scripted search approach). This should be a genuine search step,
>    not a hardcoded/pre-picked result.
> 3. **Blockchain verification** — Once a matching post is found, upload the post
>    (or a hash/fingerprint of it, e.g. the image, text, or metadata) to a
>    blockchain to create a verifiable, tamper-evident record. Any blockchain may
>    be used — public testnet, mainnet, or a local/simulated chain — as long as
>    you can demonstrate re-verifying the data against the on-chain record.
> 4. **No website required** — You do not need to build or host a project
>    website. Focus your time on the pipeline itself.
> 5. **GitHub repo required** — Your full source code must be in a GitHub repo,
>    with a README covering what the project does, how to run it, which
>    blockchain you used, and any known limitations.
>
> **Submission requirements**
>
> - GitHub repo link
> - A screen recording of the working project (no live working link required)
> - Submission form: <https://forms.gle/oZbQGuwiNeHVcHWo8>
>
> No resubmissions will be allowed — submit only when your build is final.
>
> **Screen recording**
>
> - Record your screen showing the pipeline working end to end: face scan →
>   social post found → blockchain upload/verification.
> - No editing or production needed — a plain screen recording is enough.
> - Upload it anywhere (YouTube unlisted, Google Drive, Loom, etc.) and share a
>   working link.
>
> **Timeline** — Task launch: August 31, 2026 · **Deadline: Sept 7, 2026, 11:59 PM**

### How each requirement is met

| # | Requirement | Implementation |
|---|---|---|
| 1 | Face identification | OpenCV **YuNet** detector → **SFace** `alignCrop` → 128-D embedding |
| 2 | Genuine web/social search | Live DuckDuckGo query → every candidate image downloaded, every face embedded and compared. Optional reverse-image API. **No hardcoded results.** |
| 3 | Blockchain verification | `FaceVerification.sol` on a local Hardhat EVM chain (or Sepolia). Commit → read back → re-hash → tamper detection |
| 4 | No website required | Full pipeline runs from the terminal. The UI is optional |
| 5 | GitHub repo + README | This file plus `README.md` and `SETUP.md` |

---

## 2. What this project does

```
  input face image
        │
        ▼
  YuNet.detect()            bounding box + 5 facial landmarks
        │
        ▼
  SFace.alignCrop()         canonical 112×112 aligned crop
        │
        ▼
  SFace.feature()           128-D identity embedding (L2 normalised)
        │
        ▼
  live web/social search    candidates from a LIVE query, never a fixed list
        │
        ▼
  for EVERY candidate:      download image → detect all faces → embed → compare
        │
        ├── nothing passes ──►  "No matching public post found"   (correct outcome)
        │
        ▼
  best match below threshold
        │
        ▼
  canonical JSON → SHA-256 fingerprint
        │
        ▼
  FaceVerification.recordVerification(bytes32)      on-chain commit
        │
        ▼
  getVerification(bytes32)                          read back
        │
        ▼
  re-hash the record and compare  ──►  VERIFIED / TAMPERED
```

### Match thresholds

OpenCV's published operating points for SFace:

| Metric | Match when |
|---|---|
| Cosine similarity | **≥ 0.363** |
| Euclidean (L2) distance | **≤ 1.128** |

These are the same boundary: for unit vectors `L2 = √(2(1 − cos))`, and
`√(2(1 − 0.363)) = 1.1287`.

**Do not widen the threshold to force a match.** It is validated by the
acceptance tests in section 7 with real positive and negative pairs.

---

## 3. API keys — what exists, what is required

### Nothing is required

The project runs **fully, end to end, with zero API keys**: local blockchain,
local face models, and keyless DuckDuckGo search.

### Current state of `backend/.env`

| Variable | Current value | Required? |
|---|---|---|
| `BLOCKCHAIN_RPC_URL` | `http://127.0.0.1:8545` | Yes — set |
| `CHAIN_ID` | `31337` (local Hardhat) | Yes — set |
| `CONTRACT_ADDRESS` | `0x5FbDB2315678afecb367f032d93F642f64180aa3` | Yes — set by deploy |
| `PRIVATE_KEY` | Hardhat dev account #0 | Yes — set |
| `SEPOLIA_RPC_URL` | `https://ethereum-sepolia-rpc.publicnode.com` | Only for Sepolia |
| `DEPLOYER_PRIVATE_KEY` | Hardhat dev account #0 | Only for Sepolia |
| `ETHERSCAN_API_KEY` | *(empty)* | **Optional** |
| `REVERSE_IMAGE_PROVIDER` | *(empty)* | **Optional** |
| `BING_VISUAL_SEARCH_KEY` | *(empty)* | **Optional** |
| `SERPAPI_KEY` | *(empty)* | **Optional** |

> **The `PRIVATE_KEY` in use is Hardhat's first built-in development account**
> (`0xac0974be…f2ff80`, address `0xf39Fd6e5…92266`). It is public, published in
> Hardhat's own documentation, and worthless outside a local node. It is safe to
> commit nothing and safe to share in a recording. **Never put a real key here.**

### Optional keys and what each unlocks

#### `REVERSE_IMAGE_PROVIDER` + `BING_VISUAL_SEARCH_KEY` — true face → web

Without this, a face **alone** cannot be searched against the web: a 128-D
vector cannot be fed to a text search engine. With it, the actual face image is
sent to a visual-search service which returns pages containing that image.

- Get a key: Azure Portal → create a **Bing Search v7** resource → Keys and Endpoint
- Cost: paid tiers; a free trial tier is usually available
- Set:
  ```
  REVERSE_IMAGE_PROVIDER=bing
  BING_VISUAL_SEARCH_KEY=<your key>
  ```
- Effect: `run_pipeline.py --image face.jpg` works with **no `--query` hint**

#### `SERPAPI_KEY` — Google Lens via SerpAPI

- Get a key: <https://serpapi.com> → Dashboard → API Key
- Set `REVERSE_IMAGE_PROVIDER=serpapi` and `SERPAPI_KEY=<your key>`
- **Limitation:** Google Lens needs a *publicly reachable image URL*. It cannot
  be handed a local photo, so it is skipped for local scans (with a logged
  reason). Use Bing for local files.

#### `ETHERSCAN_API_KEY` — contract verification on Sepolia

- Get a key: <https://etherscan.io/myapikey>
- Only needed for `npx hardhat verify`. Not needed to deploy or transact.

### Check what is live at any time

```powershell
cd backend
.\.venv\Scripts\python.exe -c "import json;from app.services.face_search import search_capabilities;print(json.dumps(search_capabilities(),indent=2))"
```

Or via the API: `GET http://localhost:8000/api/social/capabilities`

---

## 4. First-time setup

Three independent stacks. **They do not share a package manager.** `backend/`
has no `package.json` — `npm install` there fails by design.

```powershell
# 1. Backend — Python, NOT npm
cd "C:\Tales of Goa\backend"
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt

# 2. Blockchain
cd "C:\Tales of Goa\blockchain"
npm install
npx hardhat compile

# 3. Frontend (optional — only if you want the UI)
cd "C:\Tales of Goa\frontend"
npm install
```

### Environment file

```powershell
cd "C:\Tales of Goa\backend"
copy .env.example .env
```

`backend/.env` is gitignored and is read by **both** the Python backend and
`blockchain/hardhat.config.js`.

### Required model files

Both live in `backend/app/services/` and are already present:

| File | Size | Purpose |
|---|---|---|
| `face_detection_yunet_2023mar.onnx` | 227 KB | Face detection + 5 landmarks |
| `face_recognition_sface_2021dec.onnx` | 37 MB | 128-D identity embedding |

Source: [OpenCV Zoo](https://github.com/opencv/opencv_zoo). If either is
missing the pipeline **raises** rather than silently degrading.

---

## 5. Terminal-only operation (no GUI)

Two terminals. That is the whole system.

### Terminal 1 — local blockchain

```powershell
cd "C:\Tales of Goa\blockchain"
npm run node
```

Leave running. Prints 20 pre-funded accounts on `http://127.0.0.1:8545`.

### Terminal 2 — deploy, then run

```powershell
cd "C:\Tales of Goa\blockchain"
npm run deploy:local
```

Copy the printed address into `CONTRACT_ADDRESS` in `backend/.env`.
On a fresh Hardhat node this is deterministic:
`0x5FbDB2315678afecb367f032d93F642f64180aa3`.

Then run the pipeline:

```powershell
cd "C:\Tales of Goa\backend"

# with a search hint (works with no API key)
.\.venv\Scripts\python.exe run_pipeline.py --image "path\to\face.jpg" --query "Person Name"

# pure face-driven, no hint (needs a reverse-image API key)
.\.venv\Scripts\python.exe run_pipeline.py --image "path\to\face.jpg"

# machine-readable output
.\.venv\Scripts\python.exe run_pipeline.py --image "path\to\face.jpg" --query "Person Name" --json
```

### `run_pipeline.py` options

| Flag | Default | Notes |
|---|---|---|
| `--image` | *(required)* | Path to the input face image |
| `--query` | *(empty)* | Search hint. Omit for pure face-driven discovery |
| `--threshold` | `1.128` | SFace L2 threshold. **Do not widen to force a match** |
| `--json` | off | Print the full result object as JSON |

### Exit codes

| Code | Meaning |
|---|---|
| `0` | Match found, committed on-chain, re-verified |
| `1` | Input or environment error (missing image, models not loaded) |
| `2` | **No match found** — a correct, honest outcome, not a crash |
| `3` | Completed with warnings (e.g. chain unreachable, proof not broadcast) |

### What a successful run prints

```
  [MATCH FOUND in 22.49s]
    Mechanism     : ['DuckDuckGo (ddgs) (text-seeded, face-gated)']
    Candidates    : 12 considered / 12 verified
    Platform      : www.the-sun.com
    Post URL      : https://www.the-sun.com/sport/14521551/...

  [BIOMETRIC VERIFICATION]
    Cosine sim    : +0.6075
    Euclidean L2  : 0.8860  (threshold 1.128)
    Verdict       : MATCH CONFIRMED

    Record hash   : 0x6ed3dc8c3ee3a1feb27da5eea3700147e3a487ac...
    Tx hash       : 0xd9bd538e29a62104bacf7b301ff43d5cbb145e56...
    Block         : #8   gas 90265
    Status        : CONFIRMED

    Exists on-chain : True
    VERDICT         : VERIFIED
```

---

## 6. Blockchain operations by terminal

`backend/verify_chain.py` drives the smart contract directly — no frontend, no
Python knowledge required.

```powershell
cd "C:\Tales of Goa\backend"
```

### `status` — chain, contract and account

```powershell
.\.venv\Scripts\python.exe verify_chain.py status
```

```
  network           : Local Hardhat Node
  chain_id          : 31337
  contract_address  : 0x5FbDB2315678afecb367f032d93F642f64180aa3
  account           : 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
  balance_eth       : 9999.999
  live              : True
```

`live: True` means the RPC is reachable, the contract address is set, **and**
the signing account holds gas. Anything else and writes fall back to a clearly
labelled simulation.

### `commit` — fingerprint a record and write it on-chain

```powershell
.\.venv\Scripts\python.exe verify_chain.py commit --file record.json
.\.venv\Scripts\python.exe verify_chain.py commit --text "any string to anchor"
```

### `query` — ask the contract whether a hash exists

```powershell
.\.venv\Scripts\python.exe verify_chain.py query --hash 0xc891a6dd0c216d64299fac759bddefa2c6105fc48388d0691f64b9225952a334
```

### `demo` — the full tamper-evidence proof ⭐

**This is the command to record for the submission.**

```powershell
.\.venv\Scripts\python.exe verify_chain.py demo
.\.venv\Scripts\python.exe verify_chain.py demo --file record.json
```

It performs six steps in one run:

1. Show the original record
2. Compute its canonical SHA-256 fingerprint
3. Commit that fingerprint on-chain (real transaction, real gas)
4. Read it back via `getVerification(bytes32)`
5. Re-hash the unchanged record → must equal step 2 → **VERIFIED**
6. Alter **one digit**, re-hash, ask the chain → not found → **TAMPERED — DETECTED**

Verified output:

```
  6. TAMPER: alter ONE value, re-hash, ask the chain
  changed           : verification_metrics.euclidean_distance 0.8467 -> 0.8468
  tampered hash     : 0x2a624c8c6acf8f9acfbfaa91c79272bd385b8b47...
  exists_on_chain   : False
  VERDICT           : TAMPERED - DETECTED

  TAMPER-EVIDENCE PROVEN
```

### Raw Hardhat commands

```powershell
cd "C:\Tales of Goa\blockchain"

npm run node             # start the local chain
npm run compile          # compile contracts
npm test                 # 3 Solidity tests
npm run deploy:local     # deploy to the local node
npm run balance:sepolia  # preflight a Sepolia deployer
npm run deploy:sepolia   # deploy to Sepolia
```

### Switching to Ethereum Sepolia

1. Create a **throwaway** wallet. Never reuse a key holding real funds.
2. Fund it: <https://sepoliafaucet.com> or
   <https://www.alchemy.com/faucets/ethereum-sepolia>
3. Edit `backend/.env`:
   ```
   BLOCKCHAIN_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
   CHAIN_ID=11155111
   PRIVATE_KEY=<throwaway key>
   DEPLOYER_PRIVATE_KEY=<same throwaway key>
   CONTRACT_ADDRESS=
   ```
4. Preflight and deploy:
   ```powershell
   cd blockchain
   npm run balance:sepolia
   npm run deploy:sepolia
   ```
5. Put the printed address in `CONTRACT_ADDRESS` and restart the backend.

Transactions then carry a live `https://sepolia.etherscan.io/tx/…` link.

> **A local chain fully satisfies requirement 3** — the task explicitly allows
> "a local/simulated chain". Local is also more reliable to demo: no faucet, no
> gas, no network flakiness, instant blocks.

---

## 7. Acceptance tests

### Face recognition — positive and negative pairs

Put your own photos here (gitignored):

```
backend/tests/fixtures/
├── same_person/
│   ├── 01_you_older.jpg        two DIFFERENT photos of the SAME person
│   └── 02_you_recent.jpg
└── different_person/
    ├── 01_you.jpg
    └── 02_other_person.jpg     a clearly different person
```

```powershell
cd "C:\Tales of Goa\backend"
.\.venv\Scripts\python.exe -m tests.test_recognition
```

Verified results on real photos taken 16 months apart:

| Test | cosine | L2 | verdict |
|---|---|---|---|
| Same person, two photos | **+0.6415** | 0.8467 | **MATCH** ✓ |
| Two different people | +0.1305 | 1.3187 | **NON-MATCH** ✓ |

Threshold `1.128` sits cleanly in the gap between 0.85 and 1.32.

### Smart contract tests

```powershell
cd "C:\Tales of Goa\blockchain"
npm test
```

3 passing: records and emits the event, rejects a zero hash, reverts on an
unknown hash.

### Backend pipeline tests

```powershell
cd "C:\Tales of Goa\backend"
.\.venv\Scripts\python.exe -m tests.test_pipeline
```

---

## 8. Optional: the web UI

Not required by the task. Useful for a richer recording.

```powershell
cd "C:\Tales of Goa\frontend"
npm run dev
```

Open <http://localhost:3000> (or `:3001` if 3000 is taken). Requires the backend
on port 8000.

Three tabs:

| Tab | Purpose |
|---|---|
| **01 Automated discovery** | Upload a face → live search → on-chain proof |
| **02 1-to-1 verification** | Compare two images, auto-commits a verified match |
| **03 Registration & proof** | Webcam capture → 128-D vector → on-chain proof |

The masthead shows the live backend status, the chain, and the current block.

---

## 9. Screen-recording script

The task wants: *face scan → social post found → blockchain upload/verification*.

A terminal-only recording is sufficient and is the most convincing.

**Terminal 1**

```powershell
cd "C:\Tales of Goa\blockchain"
npm run node
```

**Terminal 2**

```powershell
cd "C:\Tales of Goa\blockchain"
npm run deploy:local
# paste the address into backend/.env -> CONTRACT_ADDRESS

cd "..\backend"

# 1. Show the environment is real
.\.venv\Scripts\python.exe verify_chain.py status

# 2. Prove recognition works — same person MATCH, different person NON-MATCH
.\.venv\Scripts\python.exe -m tests.test_recognition

# 3. Full pipeline: face -> genuine live search -> match -> chain -> VERIFIED
.\.venv\Scripts\python.exe run_pipeline.py --image "tests\fixtures\different_person\02_other_person.jpg" --query "Serena Williams"

# 4. Prove the search is genuine, not hardcoded:
#    your face + someone else's name must be REJECTED
.\.venv\Scripts\python.exe run_pipeline.py --image "tests\fixtures\same_person\02_you_recent.jpg" --query "Bill Gates"

# 5. Tamper evidence, end to end
.\.venv\Scripts\python.exe verify_chain.py demo
```

Step 4 is the strongest evidence that the search is real: the live search finds
genuine Bill Gates photos and the face check rejects **every one** of them
(L2 ≈ 1.39–1.46), so the run ends in `NO MATCH FOUND`.

> Pace the recording. DuckDuckGo rate-limits rapid repeat queries; leave ~20
> seconds between search-driven runs or a run may return few candidates.

---

## 10. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `npm error ENOENT ... backend\package.json` | `backend/` is Python. Use `pip` in the venv, not npm |
| `No face detected in the supplied image` | Face too small, turned away, or badly lit. YuNet needs a reasonably frontal face |
| `simulated: true` on every commit | `CONTRACT_ADDRESS` unset, chain not running, or account has no gas. Run `verify_chain.py status` |
| `NO MATCH FOUND` with 0 candidates | No `--query` and no reverse-image key. Add a hint, or configure Bing |
| Few candidates / flaky search | DuckDuckGo rate limiting. Wait ~20 seconds |
| Backend serves old behaviour after edits | Orphaned uvicorn worker. `Get-NetTCPConnection -LocalPort 8000` then `Stop-Process`, restart |
| `YuNet model missing` | `face_detection_yunet_2023mar.onnx` absent from `backend/app/services/` |
| Frontend on 3001 not 3000 | Another dev server holds 3000. Either is fine |
| UI heavy on integrated graphics | The 3D hero auto-detects the GPU and reduces its workload; it parks when scrolled away |

---

## 11. Known limitations

**Face-alone web discovery needs a paid API.** Without a reverse-image key the
system cannot identify an unknown person from a photo alone — no keyless service
offers this. The keyless path is text-seeded discovery with the face check
gating every result. This is honest, and the task explicitly permits "a scripted
search approach", but it is weaker than true reverse-image search.

**The system will not find a private individual.** If you are not in a public
web index, the correct answer is `NO MATCH FOUND`, and that is what it returns.
It never substitutes a stand-in identity.

**Recognition is not identity-proof.** SFace at the published threshold is
strong but not perfect. Lighting, pose, age gap and occlusion all move the
score. Thresholds are validated against real positive/negative pairs; they are
not tuned per photo.

**Search quality depends on DuckDuckGo.** Candidate page URLs come from the
image index and occasionally point at scraper sites rather than the original
source. The *face verification* is unaffected — only the attributed page URL.

**Only the fingerprint goes on-chain.** No image, no embedding, no personal data
is ever written to the blockchain — only a 32-byte SHA-256 hash. Verification
therefore proves a record has not changed; it does not publish its contents.

**Local chain state is ephemeral.** Stopping the Hardhat node discards all
blocks. Re-deploy and re-commit for each session, or use Sepolia for persistence.

**DuckDuckGo rate limiting** can reduce candidate counts on rapid repeat runs.

---

## Quick reference

```powershell
# start local chain
cd blockchain; npm run node

# deploy
cd blockchain; npm run deploy:local

# chain status
cd backend; .\.venv\Scripts\python.exe verify_chain.py status

# full pipeline
cd backend; .\.venv\Scripts\python.exe run_pipeline.py --image face.jpg --query "Name"

# tamper-evidence demo
cd backend; .\.venv\Scripts\python.exe verify_chain.py demo

# recognition tests
cd backend; .\.venv\Scripts\python.exe -m tests.test_recognition

# contract tests
cd blockchain; npm test

# optional UI
cd backend; .\.venv\Scripts\python.exe run.py
cd frontend; npm run dev
```

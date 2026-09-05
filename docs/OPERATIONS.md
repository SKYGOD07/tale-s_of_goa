# Operations Manual

**Tales of Goa — HH Goa 2026 Task #3**
Face Identification & Blockchain Verification

Running, demonstrating and submitting the project. The whole pipeline runs from
a terminal; the web UI is optional.

> Full task brief and compliance evidence: **[TASK.md](TASK.md)**
> Internals: **[ARCHITECTURE.md](ARCHITECTURE.md)** ·
> HTTP API: **[API.md](API.md)** ·
> Chain: **[BLOCKCHAIN.md](BLOCKCHAIN.md)** ·
> Install: **[SETUP.md](SETUP.md)**

---

## Contents

1. [Quick start](#1-quick-start)
2. [The task in one page](#2-the-task-in-one-page)
3. [API keys — what exists, what is required](#3-api-keys--what-exists-what-is-required)
4. [Terminal-only operation](#4-terminal-only-operation)
5. [Blockchain by terminal](#5-blockchain-by-terminal)
6. [Acceptance tests](#6-acceptance-tests)
7. [Reading the numbers](#7-reading-the-numbers)
8. [Optional: the web UI](#8-optional-the-web-ui)
9. [Screen-recording script](#9-screen-recording-script)
10. [Troubleshooting](#10-troubleshooting)
11. [Known limitations](#11-known-limitations)
12. [Appendix](#12-appendix)

---

## 1. Quick start

Assumes [SETUP.md](SETUP.md) is done.

### Terminal 1 — local blockchain

```powershell
cd "C:\Tales of Goa\blockchain"
npm run node
```

Leave it running. Prints 20 pre-funded accounts on `http://127.0.0.1:8545`.

### Terminal 2 — deploy, then run

```powershell
cd "C:\Tales of Goa\blockchain"
npm run deploy:local
```

Copy the printed address into `CONTRACT_ADDRESS` in `backend/.env`. On a fresh
node it is deterministic: `0x5FbDB2315678afecb367f032d93F642f64180aa3`.

```powershell
cd "..\backend"

# confirm the chain is genuinely live
.\.venv\Scripts\python.exe verify_chain.py status

# full pipeline
.\.venv\Scripts\python.exe run_pipeline.py --image "tests\fixtures\different_person\02_other_person.jpg" --query "Serena Williams"

# tamper-evidence proof
.\.venv\Scripts\python.exe verify_chain.py demo
```

That is the entire system. No browser, no keys.

---

## 2. The task in one page

> Pipeline shape: **Face scan input → Web/social media search (find matching
> post) → Blockchain upload/verification of the discovered data**

| # | Requirement | How it is met |
|---|---|---|
| 1 | Detect and encode a face | YuNet detect → SFace `alignCrop` → SFace 128-D feature |
| 2 | Genuine web/social search — **not hardcoded** | Live query → every candidate image face-verified → match or explicit "no match" |
| 3 | Blockchain, tamper-evident, **re-verifiable** | `FaceVerification.sol` on Hardhat EVM / Sepolia. Commit → read back → re-hash → compare |
| 4 | No website required | Two CLI entry points |
| 5 | Repo + README | `docs/` |

**Deadline: Sept 7, 2026, 11:59 PM. No resubmissions.**

Verbatim brief and per-requirement evidence: **[TASK.md](TASK.md)**.

---

## 3. API keys — what exists, what is required

### Nothing is required

The project runs **fully end to end with zero API keys**: local blockchain,
local ONNX models, keyless DuckDuckGo search.

### Current state of `backend/.env`

| Variable | Current value | Required? |
|---|---|---|
| `BLOCKCHAIN_RPC_URL` | `http://127.0.0.1:8545` | ✅ set |
| `CHAIN_ID` | `31337` (local Hardhat) | ✅ set |
| `CONTRACT_ADDRESS` | `0x5FbDB2315678afecb367f032d93F642f64180aa3` | ✅ set by deploy |
| `PRIVATE_KEY` | Hardhat dev account #0 | ✅ set |
| `SEPOLIA_RPC_URL` | `https://ethereum-sepolia-rpc.publicnode.com` | Sepolia only |
| `DEPLOYER_PRIVATE_KEY` | Hardhat dev account #0 | Sepolia only |
| `ETHERSCAN_API_KEY` | *(empty)* | ⬜ optional |
| `REVERSE_IMAGE_PROVIDER` | *(empty)* | ⬜ optional |
| `BING_VISUAL_SEARCH_KEY` | *(empty)* | ⬜ optional |
| `SERPAPI_KEY` | *(empty)* | ⬜ optional |

> **The `PRIVATE_KEY` in use is Hardhat's first built-in development account**
> — `0xac0974be…f2ff80`, address `0xf39Fd6e5…92266`. It is published in
> Hardhat's own docs, identical on every machine, and worthless outside a local
> node. Safe to show on camera. **Never put a real key here.**

### What each optional key unlocks

#### `BING_VISUAL_SEARCH_KEY` — true face → web

Without it, a face **alone** cannot be searched: a 128-D vector cannot be fed to
a text search engine. With it, the face image itself goes to a visual-search
service that returns pages containing it.

- **Get it:** Azure Portal → create a **Bing Search v7** resource → *Keys and Endpoint*
- **Cost:** paid tiers; a free trial tier is usually available
- **Set:**
  ```ini
  REVERSE_IMAGE_PROVIDER=bing
  BING_VISUAL_SEARCH_KEY=<your key>
  ```
- **Effect:** `run_pipeline.py --image face.jpg` works with **no `--query`**
- **Why Bing:** it accepts the image **binary**, so it works on a local file

#### `SERPAPI_KEY` — Google Lens

- **Get it:** <https://serpapi.com> → Dashboard → API Key
- **Set:** `REVERSE_IMAGE_PROVIDER=serpapi` and `SERPAPI_KEY=<key>`
- **Limitation:** Google Lens requires a *publicly reachable image URL*. It
  cannot be handed a local photo, so it is skipped for local scans with a logged
  reason. **Use Bing for local files.**

#### `ETHERSCAN_API_KEY` — Sepolia source verification

- **Get it:** <https://etherscan.io/myapikey>
- Only for `npx hardhat verify`. Not needed to deploy or transact.

### Check what is live, any time

```powershell
cd "C:\Tales of Goa\backend"
.\.venv\Scripts\python.exe -c "import json;from app.services.face_search import search_capabilities;print(json.dumps(search_capabilities(),indent=2))"
```

```json
{
  "reverse_image_search": null,
  "reverse_image_available": false,
  "live_search_available": true,
  "live_search_engine": "DuckDuckGo (ddgs)",
  "mode": "live_scripted"
}
```

`mode` is `reverse_image`, `live_scripted`, or `unavailable`.
Also at `GET /api/social/capabilities`, and printed by `run_pipeline.py`.

---

## 4. Terminal-only operation

### `run_pipeline.py`

```powershell
cd "C:\Tales of Goa\backend"

# with a search hint — works with no API key
.\.venv\Scripts\python.exe run_pipeline.py --image "path\to\face.jpg" --query "Person Name"

# pure face-driven, no hint — needs a reverse-image key
.\.venv\Scripts\python.exe run_pipeline.py --image "path\to\face.jpg"

# machine-readable
.\.venv\Scripts\python.exe run_pipeline.py --image "face.jpg" --query "Name" --json
```

| Flag | Default | Notes |
|---|---|---|
| `--image` | *required* | Input face image (JPEG/PNG, any size) |
| `--query` | *empty* | Search hint. Omit for pure face-driven discovery |
| `--threshold` | `1.128` | SFace L2. **Do not widen to force a match** |
| `--json` | off | Print the full result object |

### Exit codes

| Code | Meaning |
|---|---|
| `0` | Match found, committed on-chain, re-verified |
| `1` | Input/environment error — missing image, models not loaded |
| `2` | **No match found** — a correct, honest outcome |
| `3` | Completed with warnings — e.g. chain unreachable, proof not broadcast |

Usable in scripts: `if ($LASTEXITCODE -eq 2) { "no match" }`

### What a run prints

Every run opens with the real environment, so a recording shows nothing is faked:

```
>>> ENVIRONMENT
  Detector        : YuNet (face_detection_yunet_2023mar.onnx)
  Recognizer      : SFace (face_recognition_sface_2021dec.onnx)
  Thresholds      : cosine >= 0.363 | L2 <= 1.128
  Search mode     : live_scripted
  Reverse image   : not configured
  Live search     : DuckDuckGo (ddgs)
  Chain           : Local Hardhat Node (chainId 31337)
  Chain live      : True   contract: 0x5FbDB2315678afecb367f032d93F642f64180aa3
```

Then per-candidate verification — the audit trail:

```
[Face Search] mechanisms=['DuckDuckGo (ddgs) (text-seeded, face-gated)'] candidates=12
  [check ] https://people.com/…            faces=1  cos=+0.5466 L2=0.9522 -> MATCH
  [check ] https://wallpapers.com/…        faces=1  cos=+0.5704 L2=0.9270 -> MATCH
  [check ] https://www.the-sun.com/…       faces=1  cos=+0.6075 L2=0.8860 -> MATCH
  [check ] https://ca-times.brightspotcdn… faces=6  cos=+0.5299 L2=0.9696 -> MATCH
  [reject] https://static.techno-science…  image could not be downloaded or decoded
  [MATCH ] https://www.the-sun.com/sport/14521551/… L2=0.8860
```

Then the result:

```
  [MATCH FOUND in 22.49s]
    Mechanism     : ['DuckDuckGo (ddgs) (text-seeded, face-gated)']
    Candidates    : 12 considered / 12 verified
    Platform      : www.the-sun.com
    Post URL      : https://www.the-sun.com/sport/14521551/serena-williams-tennis-legend/

  [BIOMETRIC VERIFICATION]
    Cosine sim    : +0.6075
    Euclidean L2  : 0.8860  (threshold 1.128)
    Similarity    : 69.2%
    Verdict       : MATCH CONFIRMED

    Record hash   : 0x6ed3dc8c3ee3a1feb27da5eea3700147e3a487acdc93dc26e19fd239c606a84e
    Network       : Local Hardhat Node
    Simulated     : False
    Tx hash       : 0xd9bd538e29a62104bacf7b301ff43d5cbb145e567392c9c48c626c0d581f6cbe
    Block         : #8   gas 90265
    Status        : CONFIRMED

    Exists on-chain : True
    Recorder        : 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
    Identical       : True
    VERDICT         : VERIFIED

  PIPELINE COMPLETE - TAMPER-EVIDENT PROOF VERIFIED ON-CHAIN
```

### What "no match" looks like

```
  NO MATCH FOUND
  No matching public social media post found. No reverse-image provider is
  configured, so a face alone cannot be searched against the web…

  Mechanisms      : ['none']
  Candidates      : 0 considered, 0 face-verified

  This is a correct result. No identity was invented.
```

**Not a failure.** Exit code `2`.

---

## 5. Blockchain by terminal

`verify_chain.py` drives the contract directly. Full detail in
**[BLOCKCHAIN.md](BLOCKCHAIN.md)**.

```powershell
cd "C:\Tales of Goa\backend"

.\.venv\Scripts\python.exe verify_chain.py status
.\.venv\Scripts\python.exe verify_chain.py commit --file record.json
.\.venv\Scripts\python.exe verify_chain.py commit --text "any string"
.\.venv\Scripts\python.exe verify_chain.py query  --hash 0x<64 hex>
.\.venv\Scripts\python.exe verify_chain.py demo
```

### `status` — read this before every demo

```
  network           : Local Hardhat Node
  chain_id          : 31337
  contract_address  : 0x5FbDB2315678afecb367f032d93F642f64180aa3
  account           : 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
  balance_eth       : 9999.999
  live              : True
```

`live: True` = RPC reachable **and** contract set **and** account has gas.
Anything else means writes will be simulated, and `message` says why.

### `demo` ⭐ — the tamper-evidence proof

Six steps: show the record → hash it → commit → read back → re-hash (VERIFIED)
→ alter one digit → re-hash → **TAMPERED — DETECTED**.

```
  6. TAMPER: alter ONE value, re-hash, ask the chain
  changed           : verification_metrics.euclidean_distance 0.8467 -> 0.8468
  tampered hash     : 0x2a624c8c6acf8f9acfbfaa91c79272bd385b8b473cf08f01168ae9899a7c3108
  exists_on_chain   : False
  VERDICT           : TAMPERED - DETECTED

  TAMPER-EVIDENCE PROVEN
```

### Raw Hardhat

```powershell
cd "C:\Tales of Goa\blockchain"
npm run node             npm run compile          npm test
npm run deploy:local     npm run deploy:sepolia   npm run balance:sepolia
```

### Switching to Sepolia

1. Create a **throwaway** wallet — never a key holding real funds
2. Fund it: <https://sepoliafaucet.com> or
   <https://www.alchemy.com/faucets/ethereum-sepolia>
3. In `backend/.env`: `CHAIN_ID=11155111`, Sepolia RPC, the throwaway key,
   clear `CONTRACT_ADDRESS`
4. `npm run balance:sepolia` then `npm run deploy:sepolia`
5. Paste the address into `CONTRACT_ADDRESS`, restart the backend

Transactions then carry live `https://sepolia.etherscan.io/tx/…` links.

> **A local chain fully satisfies requirement 3** — the task explicitly permits
> *"a local/simulated chain"*. Local is also more reliable to demo: no faucet, no
> gas, no network flakiness, instant blocks.

---

## 6. Acceptance tests

### Recognition — positive **and** negative

Put your own photos here (gitignored):

```
backend/tests/fixtures/
├── same_person/
│   ├── 01_you_2025-05-23.jpg    two DIFFERENT photos of the SAME person
│   └── 02_you_2026-09-05.jpg    (different day / lighting / angle is ideal)
└── different_person/
    ├── 01_you.jpg
    └── 02_other_person.jpg      a clearly different person
```

The runner takes whatever two images it finds in each folder, sorted by name, so
the exact filenames do not matter.

```powershell
cd "C:\Tales of Goa\backend"
.\.venv\Scripts\python.exe -m tests.test_recognition
```

Verified on real photographs 16 months apart:

```
  detector   : YuNet (face_detection_yunet_2023mar.onnx)
  recognizer : SFace (face_recognition_sface_2021dec.onnx)
  thresholds : cosine >= 0.363 | L2 <= 1.128

TEST 1  same person, two photos  ->  expect MATCH
    01_you_2025-05-23.jpg   1280x720  faces=1  score=0.950  aligned=112x112
    02_you_2026-09-05.jpg   1280x720  faces=1  score=0.943  aligned=112x112
    cosine similarity : +0.6415
    L2 distance       : 0.8467
    verdict           : MATCH                                  PASS

TEST 2  two different people     ->  expect NON-MATCH
    cosine similarity : +0.1305
    L2 distance       : 1.3187
    verdict           : NON-MATCH                              PASS

  2/2 passed
```

**Both directions matter.** A system that matched everything would pass test 1.

### Smart contract

```powershell
cd "C:\Tales of Goa\blockchain"
npm test          # 3 passing
```

### Backend units

```powershell
cd "C:\Tales of Goa\backend"
.\.venv\Scripts\python.exe -m tests.test_pipeline
```

---

## 7. Reading the numbers

### Thresholds

| Metric | Match when | Source |
|---|---|---|
| Cosine similarity | **≥ 0.363** | OpenCV Zoo `sface.py` |
| Euclidean L2 | **≤ 1.128** | OpenCV Zoo `sface.py` |

One boundary, not two: `L2 = √(2(1 − cos))`, and `√(2(1 − 0.363)) = 1.1287`.

### Typical ranges

| Case | cosine | L2 |
|---|---|---|
| Same person, good photos | +0.55 … +0.85 | 0.55 … 0.95 |
| Same person, hard case (age gap, pose) | +0.40 … +0.55 | 0.95 … 1.10 |
| **Decision boundary** | **+0.363** | **1.128** |
| Different people | −0.10 … +0.25 | 1.22 … 1.48 |

### Similarity percentage

Not raw `cosine × 100`. The threshold is pinned at exactly **50%**, so anything
≥ 50% is a match:

| cosine | shown | verdict |
|---|---|---|
| +1.000 | 100.00% | match |
| +0.800 | 84.30% | match |
| +0.6415 | 71.86% | match ← *your same-person pair* |
| **+0.363** | **50.00%** | **boundary** |
| +0.1305 | 41.47% | non-match ← *your different-person pair* |
| 0.000 | 36.68% | non-match |

Raw cosine ×100 made a genuine boundary match read as "36%", which looks like
failure. The verdict is always driven by the **L2 threshold**, never by this
display number.

### Do not tune the threshold

If a genuine pair fails, the fix is upstream — better lighting, a more frontal
photo, a clearer face. Widening the threshold buys false accepts, and the
negative test will start failing.

---

## 8. Optional: the web UI

Not required by the task. Useful for a richer recording.

```powershell
# Terminal 3
cd "C:\Tales of Goa\backend"
.\.venv\Scripts\python.exe run.py

# Terminal 4
cd "C:\Tales of Goa\frontend"
npm run dev
```

Open <http://localhost:3000> (or `:3001`).

| Tab | Purpose |
|---|---|
| **01 Automated discovery** | Upload a face → live search → on-chain proof |
| **02 1-to-1 verification** | Compare two images; auto-commits a verified match |
| **03 Registration & proof** | Webcam → 128-D vector → on-chain proof |

The masthead shows live backend status, the chain, and the current block —
useful on camera because it proves the chain is real.

The 3D hero scene auto-detects the GPU and reduces its workload on integrated
graphics, and parks itself when scrolled out of view.

---

## 9. Screen-recording script

The task wants: *face scan → social post found → blockchain upload/verification*.

A terminal-only recording is sufficient and the most convincing. Budget ~6–8
minutes.

### Before recording

```powershell
cd "C:\Tales of Goa\backend"
.\.venv\Scripts\python.exe verify_chain.py status      # must show live : True
```

Close other terminals. Increase the font size.

### Terminal 1 — the chain

```powershell
cd "C:\Tales of Goa\blockchain"
npm run node
```

Let the account list show briefly — it proves a real EVM node.

### Terminal 2 — the demo

```powershell
cd "C:\Tales of Goa\blockchain"
npm run deploy:local
# paste the printed address into backend/.env -> CONTRACT_ADDRESS

cd "..\backend"

# 1. the environment is real, not mocked
.\.venv\Scripts\python.exe verify_chain.py status

# 2. recognition works BOTH ways
.\.venv\Scripts\python.exe -m tests.test_recognition

# 3. FULL PIPELINE: face -> genuine live search -> match -> chain -> VERIFIED
.\.venv\Scripts\python.exe run_pipeline.py --image "tests\fixtures\different_person\02_other_person.jpg" --query "Serena Williams"

#    ~20 s pause here — DuckDuckGo rate-limits rapid repeat queries

# 4. THE PROOF IT IS NOT HARDCODED:
#    your face + someone else's name must be REJECTED
.\.venv\Scripts\python.exe run_pipeline.py --image "tests\fixtures\same_person\02_you_2026-09-05.jpg" --query "Bill Gates"

# 5. tamper evidence, end to end
.\.venv\Scripts\python.exe verify_chain.py demo
```

### What to say over each step

| Step | Point to make |
|---|---|
| 1 | Real chain, real contract, funded account, `live: True` |
| 2 | Same person across 16 months matches; two different people do not. Published thresholds, not tuned |
| 3 | 12 candidates from a **live** query, each downloaded and face-verified. Real tx hash, block, gas |
| 4 | **The search genuinely finds Bill Gates and rejects every result** (L2 ≈ 1.39–1.46). A hardcoded system would have returned him |
| 5 | One digit changed → different hash → chain has no record → tampering detected |

Step 4 is the single most persuasive moment. Requirement 2 says *"not a
hardcoded/pre-picked result"*, and this demonstrates it directly.

### Pacing

DuckDuckGo rate-limits rapid repeat queries. Leave **~20 seconds** between
search-driven runs (steps 3 and 4) or one may return few candidates. If it does,
say so and re-run — an honest retry is better than an edit.

---

## 10. Troubleshooting

### Setup and processes

| Symptom | Cause | Fix |
|---|---|---|
| `npm error ENOENT … backend\package.json` | `backend/` is Python | Use `pip` in the venv, not npm |
| `ModuleNotFoundError: cv2` / `ddgs` | Wrong interpreter or missing deps | Re-run pip **with the venv python** |
| `Port 8000 already in use` | Old backend running | `Get-NetTCPConnection -LocalPort 8000` → `Stop-Process -Id <pid> -Force` |
| Backend serves old behaviour after edits | Orphaned uvicorn worker outlived its reloader | Kill the `python.exe` running `spawn_main`, restart |
| `YuNet model missing` | ONNX absent | See [SETUP.md §7](SETUP.md#7-model-files) |

### Recognition

| Symptom | Cause | Fix |
|---|---|---|
| `No face detected in the supplied image` | Face too small/turned/dark | Use a clearer, more frontal photo |
| Same person scores as NON-MATCH | Large age gap, heavy pose, occlusion | Try a closer pair. **Do not raise the threshold** |
| Different people score as MATCH | Unusual look-alike or a very poor photo | Check both crops are the intended faces |
| Detection box in the wrong place | Was a UI geometry bug — fixed | Reload the frontend |
| Portrait photo not detected | Was an EXIF bug — fixed | Restart the backend to pick it up |

### Search

| Symptom | Cause | Fix |
|---|---|---|
| `NO MATCH FOUND`, 0 candidates | No `--query` and no reverse-image key | Add a hint, or configure Bing |
| Few candidates, flaky | DuckDuckGo rate limiting | Wait ~20 s and retry |
| Candidate page URL looks like a scraper site | ddgs image index quirk | Face verification is unaffected — only attribution |
| All candidates rejected | Correct if the person is not that person | Working as intended |

### Blockchain

| Symptom | Cause | Fix |
|---|---|---|
| `simulated: true` on every commit | Contract/key unset or chain down | `verify_chain.py status`, read `message` |
| `live: false`, `connected: true` | Account has no gas | Fund it, or use the local chain |
| `exists_on_chain: false` for a record you committed | Node restarted — local state is ephemeral | Re-deploy and re-commit |
| Deploy succeeded but backend still simulates | `.env` not updated or backend not restarted | Paste the address, restart |

More: [BLOCKCHAIN.md §11](BLOCKCHAIN.md#11-blockchain-troubleshooting).

---

## 11. Known limitations

**Face-alone web discovery needs a paid API.** Without a reverse-image key the
system cannot identify an unknown person from a photo alone — no keyless service
offers this. The keyless path is text-seeded discovery with the face check
gating every result. The task explicitly permits *"a scripted search approach"*,
but this is weaker than true reverse-image search and is documented as such
rather than dressed up.

**The system will not find a private individual.** If you are not in a public
web index, the correct answer is `NO MATCH FOUND`, and that is what it returns.
It never substitutes a stand-in identity.

**Recognition is strong but not identity-proof.** SFace at the published
threshold performs well; lighting, pose, age gap and occlusion all move the
score. Thresholds are validated against real positive and negative pairs, not
tuned per photo. This is a demonstration pipeline, not an authentication system.

**Search quality depends on DuckDuckGo.** Candidate page URLs come from the
image index and occasionally point at scraper sites rather than the original
source. Face verification is unaffected — only the attributed page URL.

**Rate limiting.** Rapid repeat queries reduce candidate counts. Pace demos.

**Only the fingerprint goes on-chain.** No image, embedding, or personal data is
ever written — only a 32-byte SHA-256 hash. Verification proves a record has not
changed; it does not publish its contents, and it does not prove the record was
*true* when written.

**Local chain state is ephemeral.** Stopping the Hardhat node discards all
blocks. Re-deploy and re-commit each session, or use Sepolia for persistence.

**Single-face assumption downstream.** Detection finds every face and candidate
verification checks up to 6 per image, but the *input scan* uses the largest
face. Feed it a photo with one clear subject.

**Windows-first documentation.** Commands are PowerShell. On macOS/Linux use
`.venv/bin/python` and forward slashes; nothing else differs.

---

## 12. Appendix

### Ports

| Port | Service | Started by |
|---|---|---|
| `8545` | Hardhat JSON-RPC | `npm run node` |
| `8000` | FastAPI backend | `python run.py` |
| `3000` / `3001` | Next.js frontend | `npm run dev` |

### Entry points

| File | Purpose |
|---|---|
| `backend/run_pipeline.py` | **CLI end-to-end pipeline** |
| `backend/verify_chain.py` | **CLI blockchain operations** |
| `backend/run.py` | Starts the HTTP API |
| `backend/tests/test_recognition.py` | Recognition acceptance tests |
| `blockchain/scripts/deploy.js` | Deploy the contract |
| `blockchain/scripts/balance.js` | Sepolia preflight |

### Environment variable reference

| Variable | Purpose |
|---|---|
| `PORT` / `HOST` | Uvicorn bind |
| `BLOCKCHAIN_RPC_URL` | Chain the backend talks to |
| `CHAIN_ID` | `31337` local · `11155111` Sepolia |
| `CONTRACT_ADDRESS` | From the deploy output |
| `PRIVATE_KEY` | Signs commits |
| `SEPOLIA_RPC_URL` | Hardhat's Sepolia endpoint |
| `DEPLOYER_PRIVATE_KEY` | Deploy signer; falls back to `PRIVATE_KEY` |
| `ETHERSCAN_API_KEY` | `hardhat verify` |
| `REVERSE_IMAGE_PROVIDER` | `bing` \| `serpapi` \| empty |
| `BING_VISUAL_SEARCH_KEY` | True face → web |
| `SERPAPI_KEY` | Google Lens |

### Constants

| Constant | Value | Where |
|---|---|---|
| `SFACE_COSINE_THRESHOLD` | `0.363` | `face_processor.py` |
| `SFACE_L2_THRESHOLD` | `1.128` | `face_processor.py` |
| `YUNET_SCORE_THRESHOLD` | `0.6` | `face_processor.py` |
| `MAX_CANDIDATES` | `12` | `face_search.py` |
| `MAX_FACES_PER_CANDIDATE` | `6` | `face_search.py` |
| `RPC_TIMEOUT_SECONDS` | `20` | `blockchain.py` |
| `RECEIPT_TIMEOUT_SECONDS` | `240` | `blockchain.py` |

### Command cheat sheet

```powershell
# chain
cd blockchain; npm run node                     # start local chain
cd blockchain; npm run deploy:local             # deploy
cd blockchain; npm test                         # contract tests

# pipeline
cd backend; .\.venv\Scripts\python.exe verify_chain.py status
cd backend; .\.venv\Scripts\python.exe run_pipeline.py --image face.jpg --query "Name"
cd backend; .\.venv\Scripts\python.exe verify_chain.py demo

# tests
cd backend; .\.venv\Scripts\python.exe -m tests.test_recognition

# optional UI
cd backend; .\.venv\Scripts\python.exe run.py
cd frontend; npm run dev
```

### Pre-submission

```powershell
cd "C:\Tales of Goa"
git status --short     # .env and fixture photos must NOT appear
git check-ignore -v backend/.env
```

Checklist: **[TASK.md §4](TASK.md#4-submission-checklist)**.

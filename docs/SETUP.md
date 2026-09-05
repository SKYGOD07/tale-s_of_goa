# Setup

Installing the project from a clean clone.

---

## Contents

1. [Prerequisites](#1-prerequisites)
2. [Three stacks, three package managers](#2-three-stacks-three-package-managers)
3. [Backend — Python](#3-backend--python)
4. [Blockchain — Hardhat](#4-blockchain--hardhat)
5. [Frontend — Next.js (optional)](#5-frontend--nextjs-optional)
6. [Environment file](#6-environment-file)
7. [Model files](#7-model-files)
8. [Test fixtures](#8-test-fixtures)
9. [Verify the install](#9-verify-the-install)
10. [Setup troubleshooting](#10-setup-troubleshooting)

---

## 1. Prerequisites

| Tool | Version used | Check |
|---|---|---|
| Python | 3.11 | `python --version` |
| Node.js | 22.x | `node --version` |
| npm | 11.x | `npm --version` |
| Git | any | `git --version` |

Python 3.11 is what this was built and verified on. 3.10–3.12 should work;
`opencv-python` wheels lag on very new releases.

Disk: ~1.5 GB (Node modules dominate; the SFace model is 37 MB).

---

## 2. Three stacks, three package managers

```
Tales of Goa/
├── backend/      Python 3.11 + FastAPI    →  pip, inside a venv
├── blockchain/   Hardhat + Solidity       →  npm
└── frontend/     Next.js 16 + React 19    →  npm
```

> ### `backend/` has no `package.json` — and never will
>
> Running `npm install` or `npm run dev` there fails with:
>
> ```
> npm error code ENOENT
> npm error path C:\Tales of Goa\backend\package.json
> npm error enoent Could not read package.json
> ```
>
> That is the expected result of using the wrong tool on a Python project, not a
> broken checkout. Use `pip` inside the virtual environment.

---

## 3. Backend — Python

```powershell
cd "C:\Tales of Goa\backend"

python -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

Takes 2–5 minutes; `opencv-python` is a large wheel.

### What gets installed

| Package | Role |
|---|---|
| `fastapi` + `uvicorn` | HTTP API |
| `opencv-python` | YuNet detection, SFace recognition, all image ops |
| `pillow` | Image decode + **EXIF orientation** |
| `numpy` | Array maths |
| `pydantic` | Request/response validation |
| `web3` | Ethereum JSON-RPC, transaction signing |
| `python-dotenv` | Reads `backend/.env` |
| `httpx` | Async candidate-image downloads |
| `beautifulsoup4` | OpenGraph parsing |
| `ddgs` | **Live web/image search** — the genuine discovery layer |

> `ddgs` was referenced in the code but missing from `requirements.txt` in the
> earlier build, so the only real search silently failed inside an `except` and
> never ran. It is pinned now.

### Always invoke the venv Python explicitly

```powershell
.\.venv\Scripts\python.exe run.py            # correct
python run.py                                # may hit the system interpreter
```

Explicit paths avoid activation-state confusion, which matters when several
terminals are open.

`.venv/` is gitignored, so every clone runs this once.

---

## 4. Blockchain — Hardhat

```powershell
cd "C:\Tales of Goa\blockchain"

npm install
npx hardhat compile
npx hardhat test
```

Expected:

```
Compiled 2 Solidity files successfully (evm target: paris).

  FaceVerification Smart Contract
    ✔ Should record a biometric verification hash and emit VerificationRecorded event
    ✔ Should reject zero bytes32 hash
    ✔ Should revert when querying a hash that was never recorded

  3 passing
```

The first `compile` downloads solc 0.8.20 (~30 s once, then cached).

`node_modules/`, `artifacts/` and `cache/` are gitignored, so a fresh clone has
no compiled contracts until `compile` runs.

### Available scripts

| Command | Does |
|---|---|
| `npm run node` | Start a local chain on `:8545` |
| `npm run compile` | Compile contracts |
| `npm test` | Run the Solidity tests |
| `npm run deploy:local` | Deploy to the local node |
| `npm run deploy:sepolia` | Deploy to Sepolia |
| `npm run balance:sepolia` | Preflight RPC + key + gas |

---

## 5. Frontend — Next.js (optional)

**Not required.** The task explicitly says no website is needed, and the whole
pipeline runs from the terminal. Install only if you want the visual demo.

```powershell
cd "C:\Tales of Goa\frontend"
npm install
npm run dev
```

Serves <http://localhost:3000> (or `:3001` if 3000 is taken). Needs the backend
on port 8000.

---

## 6. Environment file

```powershell
cd "C:\Tales of Goa\backend"
copy .env.example .env
```

`backend/.env` is the **single** config file — read by both the Python backend
and `blockchain/hardhat.config.js`:

```js
require("dotenv").config({ path: require("path").resolve(__dirname, "../backend/.env") });
```

One file, no drift between the two stacks.

### Full variable reference

| Variable | Purpose | Required |
|---|---|---|
| `PORT` / `HOST` | Uvicorn bind | defaults fine |
| `BLOCKCHAIN_RPC_URL` | Chain the backend talks to | **yes** |
| `CHAIN_ID` | `31337` local · `11155111` Sepolia | **yes** |
| `CONTRACT_ADDRESS` | Set from the deploy output | **yes** |
| `PRIVATE_KEY` | Signs `recordVerification` transactions | **yes** |
| `SEPOLIA_RPC_URL` | Hardhat's Sepolia endpoint | Sepolia only |
| `DEPLOYER_PRIVATE_KEY` | Deploy signer; falls back to `PRIVATE_KEY` | Sepolia only |
| `ETHERSCAN_API_KEY` | `npx hardhat verify` | optional |
| `REVERSE_IMAGE_PROVIDER` | `bing` or `serpapi` | optional |
| `BING_VISUAL_SEARCH_KEY` | True face → web search | optional |
| `SERPAPI_KEY` | Google Lens (needs a public image URL) | optional |

### Default working configuration

```ini
BLOCKCHAIN_RPC_URL=http://127.0.0.1:8545
CHAIN_ID=31337
CONTRACT_ADDRESS=0x5FbDB2315678afecb367f032d93F642f64180aa3
PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

> That key is **Hardhat's published development account #0**
> (`0xf39Fd6e5…92266`). It is in Hardhat's own documentation, identical on every
> machine, and worthless outside a local node. Safe to show on camera.
> **Never put a real key here.**

`.env` is gitignored via both `.env` and `*.env` patterns. Verify:

```powershell
git check-ignore -v backend/.env
# .gitignore:55:*.env    backend/.env
```

---

## 7. Model files

Two ONNX models, both already in `backend/app/services/`:

| File | Size | Role |
|---|---|---|
| `face_detection_yunet_2023mar.onnx` | 232,589 B (227 KB) | Detection + 5 landmarks |
| `face_recognition_sface_2021dec.onnx` | 38,696,353 B (37 MB) | 128-D embedding |

Source: [OpenCV Zoo](https://github.com/opencv/opencv_zoo).

If either is missing the pipeline **raises `ModelUnavailable`** rather than
falling back to something weaker.

Re-download if needed:

```powershell
cd "C:\Tales of Goa\backend\app\services"
curl -L -o face_detection_yunet_2023mar.onnx `
  "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx"
```

Confirm they load:

```powershell
cd "C:\Tales of Goa\backend"
.\.venv\Scripts\python.exe -c "import json;from app.services.face_processor import models_ready;print(json.dumps(models_ready(),indent=2))"
```

```json
{
  "detector": "YuNet (face_detection_yunet_2023mar.onnx)",
  "recognizer": "SFace (face_recognition_sface_2021dec.onnx)",
  "detector_loaded": true,
  "recognizer_loaded": true,
  "embedding_dimension": 128,
  "cosine_threshold": 0.363,
  "l2_threshold": 1.128
}
```

---

## 8. Test fixtures

Add your own photographs (gitignored — they never leave your machine):

```
backend/tests/fixtures/
├── same_person/
│   ├── 01_you_older.jpg        two DIFFERENT photos of the SAME person
│   └── 02_you_recent.jpg       different day / lighting / angle is ideal
└── different_person/
    ├── 01_you.jpg
    └── 02_other_person.jpg     a clearly different person
```

`.jpg`, `.jpeg`, `.png`, `.webp` and `.bmp` all work. The runner takes whatever
two images it finds in each folder, sorted by name — filenames do not matter.

A negative pair is as important as a positive one: a system that matches
everything passes the same-person test.

---

## 9. Verify the install

Run all four. Each should pass before you rely on the system.

```powershell
# 1. models load
cd "C:\Tales of Goa\backend"
.\.venv\Scripts\python.exe -c "from app.services.face_processor import models_ready;print(models_ready())"

# 2. contracts compile and pass
cd "..\blockchain"
npm test                                       # 3 passing

# 3. chain reachable  (start `npm run node` in another terminal first,
#    then `npm run deploy:local` and paste the address into backend/.env)
cd "..\backend"
.\.venv\Scripts\python.exe verify_chain.py status    # live : True

# 4. recognition acceptance tests  (needs your fixture photos)
.\.venv\Scripts\python.exe -m tests.test_recognition # 2/2 passed
```

Then the full pipeline:

```powershell
.\.venv\Scripts\python.exe run_pipeline.py --image "tests\fixtures\same_person\02_you_recent.jpg" --query "Your Name"
```

---

## 10. Setup troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `npm error ENOENT … backend\package.json` | Wrong package manager | `backend/` is Python — use `pip` in the venv |
| `ModuleNotFoundError: cv2` | Deps not installed, or wrong interpreter | Re-run pip **with the venv python** |
| `ModuleNotFoundError: ddgs` | Older `requirements.txt` | `.\.venv\Scripts\python.exe -m pip install ddgs` |
| `YuNet model missing` | ONNX absent | Re-download — §7 |
| `HH: Cannot connect to the network localhost` | Node not running | `cd blockchain; npm run node` |
| `solc 0.8.20 not found` | First compile, no network | Connect once; solc is cached after |
| `Port 8000 is already in use` | Old backend still running | `Get-NetTCPConnection -LocalPort 8000` then `Stop-Process -Id <pid> -Force` |
| Backend serves old behaviour after edits | Orphaned uvicorn worker outlived its reloader | Kill the `python.exe` running `spawn_main`, restart |
| `python` resolves to the wrong version | PATH ordering | Use `.\.venv\Scripts\python.exe` explicitly |
| Frontend on 3001 not 3000 | Port taken | Either is fine — the backend URL is what matters |

### Finding orphaned backend processes

```powershell
Get-CimInstance Win32_Process -Filter "Name='python.exe'" |
  Select-Object ProcessId, CommandLine | Format-Table -AutoSize
```

Uvicorn's reloader spawns a worker via `multiprocessing.spawn`. Killing only the
parent leaves the worker holding port 8000 and serving **stale code** — a real
trap after editing backend files.

---

## Next

- Run and demo it → **[OPERATIONS.md](OPERATIONS.md)**
- Understand the internals → **[ARCHITECTURE.md](ARCHITECTURE.md)**
- Drive the chain → **[BLOCKCHAIN.md](BLOCKCHAIN.md)**

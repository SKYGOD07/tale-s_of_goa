# Documentation

**Tales of Goa — HH Goa 2026 Shortlisting Task #3**
Face Identification & Blockchain Verification

---

## Start here

| If you want to… | Read |
|---|---|
| Install the project from scratch | **[SETUP.md](SETUP.md)** |
| Run it, demo it, record it | **[OPERATIONS.md](OPERATIONS.md)** |
| Understand how it works inside | **[ARCHITECTURE.md](ARCHITECTURE.md)** |
| Call the HTTP API | **[API.md](API.md)** |
| Work with the smart contract | **[BLOCKCHAIN.md](BLOCKCHAIN.md)** |
| Check task compliance | **[TASK.md](TASK.md)** |
| Review the face-finder design and safeguards | **[FACE_FINDER_BUILD.md](FACE_FINDER_BUILD.md)** |
| Read the original brief | **[task/task #3.txt](task/task%20%233.txt)** |

---

## The 60-second version

```
face image → YuNet detect → SFace align+embed → live web search
           → verify every candidate face → SHA-256 → blockchain → re-verify
```

Two terminals, no GUI, no API keys:

```powershell
# Terminal 1
cd blockchain; npm run node

# Terminal 2
cd blockchain; npm run deploy:local
#   → paste the printed address into backend/.env as CONTRACT_ADDRESS

cd ..\backend
.\.venv\Scripts\python.exe run_pipeline.py --image "tests\fixtures\different_person\02_other_person.jpg" --query "Serena Williams"
.\.venv\Scripts\python.exe verify_chain.py demo
```

---

## Document map

### [SETUP.md](SETUP.md)
Installing the three independent stacks (Python backend, Hardhat blockchain,
Next.js frontend), the environment file, and the required ONNX models.
Explains why `npm install` in `backend/` fails by design.

### [OPERATIONS.md](OPERATIONS.md)
The main manual. Task text, what each API key unlocks, terminal-only operation,
blockchain commands, acceptance tests, a copy-paste screen-recording script,
troubleshooting, and known limitations.

### [ARCHITECTURE.md](ARCHITECTURE.md)
How the pipeline actually works: every module and what it owns, the exact
recognition chain, why alignment matters, how genuine discovery is enforced,
the canonical-hash design, and a record of what was wrong before the audit.

### [API.md](API.md)
All nine HTTP endpoints with request and response shapes, real captured
examples, error semantics, and `curl` recipes.

### [BLOCKCHAIN.md](BLOCKCHAIN.md)
`FaceVerification.sol` line by line, the ABI, gas costs, the tamper-evidence
model, local vs Sepolia, and every terminal command for driving the chain.

### [TASK.md](TASK.md)
The brief reproduced verbatim, a requirement-by-requirement compliance matrix
with evidence, and the submission checklist.

### [FACE_FINDER_BUILD.md](FACE_FINDER_BUILD.md)
The two discovery modes, the fixed biometric decision threshold, media evidence
fingerprinting, authorization gate, and recording checklist for the Face Finder.

---

## Verified results

Measured on real photographs taken 16 months apart:

| Test | cosine | L2 | expected | actual |
|---|---|---|---|---|
| Same person, two photos | **+0.6415** | 0.8467 | MATCH | **MATCH** ✓ |
| Two different people | +0.1305 | 1.3187 | NON-MATCH | **NON-MATCH** ✓ |

Decision threshold `L2 ≤ 1.128` sits cleanly in the gap between 0.85 and 1.32.

Full pipeline, live run: 12 candidates from a live search, all face-verified,
best match at L2 0.8860 → SHA-256 → real transaction (block 8, gas 90,265,
`simulated: false`) → read back → **VERIFIED**. Altering one digit of the record
produces a hash the chain has never seen → **TAMPERED — DETECTED**.

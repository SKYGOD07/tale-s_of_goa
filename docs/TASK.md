# Task & Compliance

The brief reproduced verbatim, then a requirement-by-requirement compliance
matrix with evidence.

Source: [`task/task #3.txt`](task/task%20%233.txt)

---

## 1. The brief

> ### HH Goa 2026 Shortlisting Task 3: Face Identification & Blockchain Verification
>
> #### What to build
>
> A pipeline that takes a face scan as input, identifies matching content on the
> web/social media, and then verifies that discovered data using a blockchain —
> end to end.
>
> **Pipeline shape:** Face scan input → Web/social media search (find matching
> post) → Blockchain upload/verification of the discovered data
>
> #### Technical requirements
>
> **1. Face identification**
> Detect and encode a face from an input image (any face detection/recognition
> library or API is acceptable).
>
> **2. Social media / web search**
> Use the face to search the web and find at least one real, matching social
> media post (via reverse image search, an API, or a scripted search approach).
> This should be a genuine search step, not a hardcoded/pre-picked result.
>
> **3. Blockchain verification**
> Once a matching post is found, upload the post (or a hash/fingerprint of it,
> e.g. the image, text, or metadata) to a blockchain to create a verifiable,
> tamper-evident record. Any blockchain may be used — public testnet, mainnet,
> or a local/simulated chain — as long as you can demonstrate re-verifying the
> data against the on-chain record.
>
> **4. No website required**
> You do not need to build or host a project website. Focus your time on the
> pipeline itself.
>
> **5. GitHub repo required**
> Your full source code must be in a GitHub repo, with a README covering what
> the project does, how to run it, which blockchain you used, and any known
> limitations.
>
> #### Submission requirements
>
> - GitHub repo link
> - A screen recording of the working project (no live working link required)
> - Submission form link: <https://forms.gle/oZbQGuwiNeHVcHWo8>
>
> No resubmissions will be allowed — submit only when your build is final.
>
> #### Screen recording
>
> - Record your screen showing the pipeline working end to end: face scan →
>   social post found → blockchain upload/verification.
> - No editing or production needed — a plain screen recording is enough.
> - Upload it anywhere (YouTube unlisted, Google Drive, Loom, etc.) and share a
>   working link.
>
> #### Timeline
>
> - Task launch: August 31, 2026
> - **Deadline: Sept 7, 2026, 11:59 PM**

---

## 2. Compliance matrix

### Requirement 1 — Face identification

> Detect and encode a face from an input image.

**Status: met.**

| Stage | Implementation |
|---|---|
| Detect | **YuNet** (`cv2.FaceDetectorYN`, OpenCV Zoo) — bounding box + 5 landmarks |
| Align | **SFace `alignCrop()`** — landmark-driven warp to canonical 112×112 |
| Encode | **SFace `feature()`** — 128-D identity embedding, L2 normalised |
| Compare | **SFace `match()`** — cosine and L2, OpenCV's own implementation |

This is the official OpenCV Zoo pipeline, not a bespoke construction.

**Evidence** — `backend/tests/test_recognition.py` on real photographs taken
16 months apart:

```
TEST 1  same person, two photos  ->  expect MATCH
    01_you_2025-05-23.jpg   1280x720  faces=1  score=0.950  aligned=112x112
    02_you_2026-09-05.jpg   1280x720  faces=1  score=0.943  aligned=112x112
    cosine similarity : +0.6415   (match needs >= 0.363)
    L2 distance       : 0.8467    (match needs <= 1.128)
    verdict           : MATCH                                    PASS

TEST 2  two different people     ->  expect NON-MATCH
    cosine similarity : +0.1305
    L2 distance       : 1.3187
    verdict           : NON-MATCH                                PASS

2/2 passed
```

Validated in **both** directions — a system that matches everything would pass
test 1 alone.

---

### Requirement 2 — Social media / web search

> Use the face to search the web and find at least one real, matching social
> media post… **This should be a genuine search step, not a hardcoded/pre-picked
> result.**

**Status: met, with a stated constraint.**

#### Architecture

```
input face → live search (reverse-image API, or live text+image query)
           → for EVERY candidate: download → detect ALL faces → align → embed
           → compare against the input face
           → return ONLY if a candidate passes the biometric threshold
           → otherwise: "No matching public social media post found."
```

There is **no candidate list anywhere in the codebase.** Every candidate URL is
produced by a live network query at runtime.

#### Evidence A — a genuine match

Live run, 12 candidates from a live DuckDuckGo query, all face-verified:

```
[check] cdn.arstechnica.net/…      faces=1  cos=+0.6572  L2=0.8280 -> MATCH
[check] somoslibres.org/…          faces=1  cos=+0.4767  L2=1.0230 -> MATCH
[check] cdn.britannica.com/…       faces=1  cos=+0.6661  L2=0.8171 -> MATCH
[reject] techno-science.net/…      image could not be downloaded
…
[MATCH] L2=0.8171
```

#### Evidence B — the search is genuinely face-gated

Input: one person's face. Hint: **"Bill Gates"**. The search finds real Bill
Gates pages; the face check rejects **every single one**:

```
L2=1.3926  faces=1  rejected  wallpapers.com/…bill-gates-in-suit…
L2=1.4036  faces=1  rejected  wallpapers.com/…bill-gates-portrait…
L2=1.4267  faces=1  rejected  gatesfoundation.org/…
L2=1.4561  faces=1  rejected  media.ambito.com/…
L2=1.4588  faces=1  rejected  aarp.widen.net/…
L2=1.4602  faces=1  rejected  pdmedia.b-cdn.net/…

[NO MATCH] nothing passed the threshold
```

**This is the strongest available proof that results are not pre-picked.** A
hardcoded system would have returned the Bill Gates page.

#### Evidence C — honest empty results

An unindexed face with no hint returns:

```
NO MATCH FOUND
  No matching public social media post found. No reverse-image provider is
  configured, so a face alone cannot be searched against the web.

  Mechanisms      : ['none']
  Candidates      : 0 considered, 0 face-verified

  This is a correct result. No identity was invented.
```

#### Stated constraint

Without a reverse-image API key, discovery is **text-seeded**: a hint supplies
candidates and the face check decides. The task explicitly permits *"a scripted
search approach"*, so this satisfies the requirement — but it is weaker than
true reverse-image search, and the documentation says so rather than implying
otherwise. Setting `REVERSE_IMAGE_PROVIDER=bing` with a key enables true
face-only discovery.

#### What was removed

The earlier build contained `AUTONOMOUS_CANDIDATE_POOL` — **five hardcoded
people** (a collaborator's GitHub account, Linus Torvalds, Guillermo Rauch,
Guido van Rossum, Elon Musk). It downloaded those five avatars and returned
whichever was closest, which is how an unrelated face "discovered" Guido van
Rossum. Additionally, the query path performed **no face verification at all**.

Both are deleted. See
[ARCHITECTURE.md §12](ARCHITECTURE.md#12-audit-history--what-was-wrong-before).

---

### Requirement 3 — Blockchain verification

> Upload the post (or a hash/fingerprint of it) to a blockchain to create a
> verifiable, tamper-evident record… as long as you can demonstrate
> **re-verifying** the data against the on-chain record.

**Status: met.**

| Element | Implementation |
|---|---|
| Chain | Local **Hardhat EVM** (31337) by default; **Ethereum Sepolia** (11155111) supported |
| Contract | `FaceVerification.sol`, Solidity 0.8.20 |
| Commit | `recordVerification(bytes32)` — 90,265 gas |
| Read back | `getVerification(bytes32)` — `view`, free |
| Fingerprint | SHA-256 over canonical JSON (sorted keys, compact separators) |
| Stored | Hash, `block.timestamp`, `msg.sender` — **no image, no embedding** |

The task explicitly allows *"a local/simulated chain"*.

**Evidence** — `verify_chain.py demo`:

```
2. CANONICAL SHA-256 FINGERPRINT
   0xc891a6dd0c216d64299fac759bddefa2c6105fc48388d0691f64b9225952a334

3. COMMIT TO CHAIN
   tx hash           : 0x83abe56886919cbe97e5348a0a8543fbc9a878788897aa6d78fbfef06978fddd
   block             : 7   gas 90265
   simulated         : False

4. READ BACK FROM THE CONTRACT
   exists_on_chain   : True
   recorder          : 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266

5. RE-HASH THE UNCHANGED RECORD
   identical         : True
   VERDICT           : VERIFIED

6. TAMPER: alter ONE value, re-hash, ask the chain
   changed           : euclidean_distance 0.8467 -> 0.8468
   tampered hash     : 0x2a624c8c6acf8f9acfbfaa91c79272bd385b8b473cf08f01168ae9899a7c3108
   exists_on_chain   : False
   VERDICT           : TAMPERED - DETECTED
```

Re-verification is demonstrated in both directions: the intact record verifies,
and a fourth-decimal-place change is detected.

**Honesty guardrail.** When the chain is unreachable the result is flagged
`simulated: true`, `block_number: null`, `status: "simulated"`, and the UI
renders it amber as *"SIMULATED PROOF — NOT BROADCAST ON-CHAIN"*. The earlier
build returned fabricated transaction hashes labelled `"confirmed"` with a
hardcoded block number.

---

### Requirement 4 — No website required

> You do not need to build or host a project website.

**Status: met.** The complete pipeline runs from a terminal:

```powershell
python run_pipeline.py --image face.jpg --query "Name"
python verify_chain.py demo
```

A Next.js UI exists as an optional extra and is not required for any part of the
demonstration. Nothing is hosted.

---

### Requirement 5 — GitHub repo + README

> README covering what the project does, how to run it, which blockchain you
> used, and any known limitations.

**Status: met.**

| README must cover | Where |
|---|---|
| What the project does | [README.md](README.md#the-60-second-version), [ARCHITECTURE.md](ARCHITECTURE.md) |
| How to run it | [SETUP.md](SETUP.md), [OPERATIONS.md §5](OPERATIONS.md#5-terminal-only-operation-no-gui) |
| Which blockchain | [BLOCKCHAIN.md](BLOCKCHAIN.md) — Hardhat EVM local / Sepolia |
| Known limitations | [OPERATIONS.md §11](OPERATIONS.md#11-known-limitations) |

---

## 3. Summary

| # | Requirement | Status | Primary evidence |
|---|---|---|---|
| 1 | Face identification | ✅ | 2/2 acceptance tests on real photos |
| 2 | Genuine web/social search | ✅ | Bill Gates rejection; no candidate list in code |
| 3 | Blockchain verification | ✅ | `verify_chain.py demo` — VERIFIED + TAMPERED DETECTED |
| 4 | No website required | ✅ | Two CLI entry points |
| 5 | Repo + README | ✅ | `docs/` |

---

## 4. Submission checklist

- [ ] **Final run passes** — `test_recognition` 2/2, `npm test` 3 passing
- [ ] **Chain is live** — `verify_chain.py status` shows `live : True`
- [ ] **Not simulated** — pipeline output shows `Simulated : False`
- [ ] **Screen recording** covering, in order:
  - [ ] `verify_chain.py status` — the environment is real
  - [ ] `python -m tests.test_recognition` — MATCH and NON-MATCH
  - [ ] `run_pipeline.py … --query "…"` — face → live search → match → chain → VERIFIED
  - [ ] `run_pipeline.py …` with a **wrong** name — rejection proves the search is genuine
  - [ ] `verify_chain.py demo` — tamper evidence
- [ ] Recording uploaded, link works when logged out
- [ ] GitHub repo pushed; `.env` and `tests/fixtures/*.jpg` are **not** committed
- [ ] Form submitted: <https://forms.gle/oZbQGuwiNeHVcHWo8>

> **No resubmissions.** Verify the recording plays and the repo link opens in a
> private window before submitting.

The full recording script is in
[OPERATIONS.md §9](OPERATIONS.md#9-screen-recording-script).

### Before pushing

```powershell
cd "C:\Tales of Goa"
git status --short          # .env and fixture photos must NOT appear
git check-ignore -v backend/.env backend/tests/fixtures/same_person/01_you_2025-05-23.jpg
```

Both must report as ignored.

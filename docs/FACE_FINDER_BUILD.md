# Face Finder Build Note

## Purpose

Task 3 requires a real end-to-end chain from a face scan to public-web discovery, biometric verification, and a tamper-evident blockchain record. This document describes the implemented Face Finder behavior and the boundary between the two supported discovery modes.

## What Was Reviewed

- The task brief in `docs/task/task #3.txt`.
- The repository documentation, backend pipeline, EVM contract, CLI, FastAPI routes, and optional Next.js interface.
- FaceCheck's public flow at `https://facecheck.id`: upload an image, obtain matches from public web sources, expose confidence bands, require acknowledgement of terms, and warn that a face result is not enough to establish identity.

The implementation does not call, scrape, copy, or depend on FaceCheck. It adopts only defensible product principles: explicit authorization, a visible uncertainty boundary, and an auditable result.

## Implemented Pipeline

1. **Face ingestion**: YuNet detects the largest input face and SFace produces a unit-normalized 128-dimensional embedding.
2. **Candidate discovery**:
   - **Reverse-image mode** sends the supplied image to a configured Bing Visual Search provider. This is the only face-only discovery mode.
   - **Face-gated live search** requires a public name, handle, or URL hint. DuckDuckGo produces fresh web and social candidates; it does not decide identity.
3. **Candidate verification**: every candidate image is downloaded, each detected face is embedded, and only a face at or below the fixed SFace threshold of `L2 <= 1.128` may pass.
4. **Evidence fingerprinting**: the exact candidate media bytes receive a SHA-256 digest. The canonical record includes the public URL, metadata, media digest, discovery mechanism, fixed threshold, and biometric metrics.
5. **Blockchain proof**: SHA-256 of the canonical record is committed to `FaceVerification.sol`; the pipeline reads it back using `getVerification` and recomputes the record hash.

## Product Safeguards

- The web UI requires the submitter to confirm they are authorized to use the face image.
- The UI shows the threshold as a disabled reference control. Users cannot widen the decision boundary to force a match.
- Empty searches, download failures, and non-matches remain `NO_MATCH`; no substitute identity or preselected candidate is returned.
- Media and biometric vectors remain off-chain. The blockchain receives only the 32-byte canonical-record fingerprint.
- A match is an investigatory lead, not proof of identity or a basis for employment, credit, insurance, housing, or similar consequential decisions.

## Verification Checklist

```powershell
cd backend
.\.venv\Scripts\python.exe -m py_compile app\services\face_search.py app\services\social_search.py app\routes\social.py
.\.venv\Scripts\python.exe -c "import runpy; tests = runpy.run_path('tests/test_pipeline.py'); tests['test_social_search_requires_authorized_use']()"

cd ..\blockchain
npm test
```

For a full recording, start a local Hardhat node, deploy the contract, and run `backend/run_pipeline.py` with an image and a public search hint. Show one positive run, one mismatch run, the candidate audit, the media SHA-256, the transaction hash, and the `getVerification` read-back.

## Known Limits

- Reverse-image discovery needs a configured third-party provider and API key.
- The no-key path is text-seeded discovery followed by face verification; it is not anonymous face-only web search.
- Public search indexes, platform login walls, rate limits, image quality, lighting, and pose affect coverage.
- A local Hardhat chain is suitable for a reproducible demo but is not persistent after the node restarts.

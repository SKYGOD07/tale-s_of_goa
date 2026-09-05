# Setup

Three independent stacks live in this repo. **They do not share a package manager.**

| Directory    | Stack                | Install with            |
|--------------|----------------------|-------------------------|
| `backend/`   | Python 3.11 + FastAPI| `pip` in a virtualenv   |
| `frontend/`  | Next.js 16 + React 19| `npm install`           |
| `blockchain/`| Hardhat + Solidity   | `npm install`           |

> `backend/` has **no `package.json`** and never will — running `npm install` or
> `npm run dev` there fails with `ENOENT ... package.json`. That is the expected
> result of using the wrong tool, not a broken checkout.

---

## 1. Backend — Python / FastAPI

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

Run it:

```powershell
cd backend
.\.venv\Scripts\python.exe run.py
```

API on <http://localhost:8000>, Swagger docs at `/docs`.

`.venv/` is gitignored, so every clone has to do this once.

---

## 2. Blockchain — Hardhat

```powershell
cd blockchain
npm install
npx hardhat compile
npx hardhat test
```

`node_modules/`, `artifacts/` and `cache/` are gitignored, so a fresh clone has
no compiled contracts until `compile` runs.

---

## 3. Frontend — Next.js

```powershell
cd frontend
npm install
npm run dev
```

UI on <http://localhost:3000>.

---

## 4. Environment & Ethereum Sepolia testnet

`backend/.env` is the single config file — the Python backend **and**
`blockchain/hardhat.config.js` both read it. It is gitignored; copy the template:

```powershell
cd backend
copy .env.example .env
```

### Point it at Sepolia

The defaults already target Sepolia (`CHAIN_ID=11155111`). You need to supply
two values:

**a. A funded testnet account.** Create a throwaway wallet — never reuse a key
that holds real funds — and fund it from a faucet:

- <https://sepoliafaucet.com>
- <https://www.alchemy.com/faucets/ethereum-sepolia>

Put its private key in both `PRIVATE_KEY` and `DEPLOYER_PRIVATE_KEY`.

**b. An RPC endpoint.** `https://ethereum-sepolia-rpc.publicnode.com` is
pre-filled and works without an API key. A dedicated Alchemy or Infura endpoint
is more reliable for deployment — set it as `SEPOLIA_RPC_URL`.

Check the wiring before deploying:

```powershell
cd blockchain
npm run balance:sepolia
```

### Deploy

```powershell
cd blockchain
npm run deploy:sepolia
```

Copy the printed address into `CONTRACT_ADDRESS` in `backend/.env` and restart
the backend. The UI's **Network** badge turns green and reads `live` once the
RPC is reachable, the contract address is set, and the account holds gas.

### Local chain instead

To develop against a local node rather than Sepolia, set in `backend/.env`:

```
BLOCKCHAIN_RPC_URL=http://127.0.0.1:8545
CHAIN_ID=31337
```

then:

```powershell
cd blockchain
npm run node          # terminal 1
npm run deploy:local  # terminal 2
```

---

## Simulated mode

If the contract address or private key is missing, or the RPC is unreachable,
the backend still completes the pipeline but returns the proof flagged
`simulated: true` with the reason attached. The UI shows these in amber as
**"SIMULATED PROOF — NOT BROADCAST ON-CHAIN"**. A simulated result is never
presented as a confirmed transaction.

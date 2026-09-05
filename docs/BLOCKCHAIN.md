# Blockchain Guide

`FaceVerification.sol`, the tamper-evidence model, and every terminal command
for driving the chain without a GUI.

---

## Contents

1. [Why a blockchain at all](#1-why-a-blockchain-at-all)
2. [The contract](#2-the-contract)
3. [ABI and gas](#3-abi-and-gas)
4. [The tamper-evidence model](#4-the-tamper-evidence-model)
5. [Terminal operations](#5-terminal-operations)
6. [Local Hardhat chain](#6-local-hardhat-chain)
7. [Ethereum Sepolia](#7-ethereum-sepolia)
8. [Simulated mode](#8-simulated-mode)
9. [Transaction construction](#9-transaction-construction)
10. [Contract tests](#10-contract-tests)
11. [Blockchain troubleshooting](#11-blockchain-troubleshooting)

---

## 1. Why a blockchain at all

Task requirement 3:

> Once a matching post is found, upload the post (or a hash/fingerprint of it) to
> a blockchain to create a verifiable, **tamper-evident** record. Any blockchain
> may be used — public testnet, mainnet, or a local/simulated chain — as long as
> you can demonstrate **re-verifying** the data against the on-chain record.

The property being bought is *immutability of a commitment*. Once a fingerprint
is in a block, nobody — including us — can alter it without leaving a trace.
Later, anyone holding the record can recompute its hash and ask the chain
whether that exact fingerprint was ever committed.

Two consequences:

- **A single altered digit changes the hash entirely.** SHA-256 has no partial
  matching. Change `0.8467` to `0.8468` and the digest is unrelated.
- **The chain has no record of the altered version.** So tampering is detected
  by *absence*, not by comparison.

### What is NOT stored

No image. No embedding. No name. No URL. **Only a 32-byte digest.**

The contract's own header says so:

```solidity
 * IMPORTANT: Raw face images or biometric embedding vectors are NEVER stored on-chain.
```

This matters for a biometric system: the on-chain record proves a document has
not changed, without publishing anything about the person.

---

## 2. The contract

`blockchain/contracts/FaceVerification.sol` — Solidity 0.8.20, optimizer on
(200 runs).

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract FaceVerification {
    struct VerificationRecord {
        bytes32 recordHash;
        uint256 timestamp;
        address recorder;
    }

    mapping(bytes32 => VerificationRecord) public records;

    event VerificationRecorded(
        bytes32 indexed recordHash,
        uint256 timestamp,
        address indexed recorder
    );

    function recordVerification(bytes32 recordHash) external returns (bool) {
        require(recordHash != bytes32(0), "Invalid record hash");

        records[recordHash] = VerificationRecord({
            recordHash: recordHash,
            timestamp: block.timestamp,
            recorder: msg.sender
        });

        emit VerificationRecorded(recordHash, block.timestamp, msg.sender);
        return true;
    }

    function getVerification(bytes32 recordHash)
        external view returns (uint256 timestamp, address recorder)
    {
        VerificationRecord memory rec = records[recordHash];
        require(rec.timestamp != 0, "Record hash not found");
        return (rec.timestamp, rec.recorder);
    }
}
```

### Design notes

| Choice | Reason |
|---|---|
| Keyed by the hash itself | Lookup is by fingerprint. There is no id to remember |
| `require(recordHash != bytes32(0))` | The zero hash is the mapping's own empty value; allowing it would make "not found" ambiguous |
| `getVerification` **reverts** when absent | An explicit negative answer. The backend translates it to `exists_on_chain: false` |
| `block.timestamp` not a parameter | The chain, not the caller, decides when. A caller cannot backdate a record |
| `msg.sender` recorded | Provenance: which account made the commitment |
| `indexed` hash and recorder | Log filtering by either without scanning every block |
| No owner, no admin, no upgrade path | Nothing to compromise. Records cannot be deleted or rewritten by anyone |

### Storage layout

```
records[0x6ed3dc8c…] = {
    recordHash: 0x6ed3dc8c…,          32 bytes
    timestamp : 1788635722,           32 bytes
    recorder  : 0xf39Fd6e5…92266      32 bytes (20 used)
}
```

Three storage slots per record — the dominant gas cost.

---

## 3. ABI and gas

### Minimal ABI

Mirrored in `backend/app/services/blockchain.py` as `CONTRACT_ABI`:

| Type | Signature | Mutability |
|---|---|---|
| function | `recordVerification(bytes32) returns (bool)` | `nonpayable` |
| function | `getVerification(bytes32) returns (uint256, address)` | `view` |
| event | `VerificationRecorded(bytes32 indexed, uint256, address indexed)` | — |

### Measured gas — real values from this chain

| Operation | Gas | Notes |
|---|---|---|
| Contract deployment | **205,217** | One-off |
| `recordVerification` — first ever call | **90,253** | |
| `recordVerification` — subsequent | **90,265** | 3 cold `SSTORE`s + a 2-topic log |
| `getVerification` | **0** | `view` — `eth_call`, no transaction |

Read-back is **free**. Verification costs nothing, which is exactly the right
shape: commit once, verify unlimited times.

Sepolia cost estimate at 20 gwei: ≈ `90,265 × 20 gwei ≈ 0.0018 ETH` per commit —
comfortably inside a faucet drip.

---

## 4. The tamper-evidence model

```
   RECORD (canonical JSON, sorted keys, compact separators)
        │
        │  SHA-256
        ▼
   FINGERPRINT  0x6ed3dc8c3ee3a1feb27da5eea3700147e3a487ac…
        │
        │  recordVerification(bytes32)      ← one transaction
        ▼
   ON-CHAIN  { hash, block.timestamp, msg.sender }     immutable
        │
        │  ── later, by anyone ──
        │
        │  getVerification(bytes32)         ← free read
        ▼
   ┌────────────────┬────────────────────────────────────────┐
   │ record intact  │  re-hash == stored → present → VERIFIED │
   │ record altered │  re-hash != stored → absent  → TAMPERED │
   └────────────────┴────────────────────────────────────────┘
```

### Why determinism matters

```python
canonical_json = json.dumps(record, sort_keys=True, separators=(',', ':'))
```

Without `sort_keys=True`, two semantically identical records could serialise
differently (dict order, platform, library version) and produce different
digests — a false "tampered". Sorting removes that entire class of failure.

### Demonstrated

```
  6. TAMPER: alter ONE value, re-hash, ask the chain
  changed           : verification_metrics.euclidean_distance 0.8467 -> 0.8468
  tampered hash     : 0x2a624c8c6acf8f9acfbfaa91c79272bd385b8b473cf08f01168ae9899a7c3108
  exists_on_chain   : False
  VERDICT           : TAMPERED - DETECTED
```

Original: `0xc891a6dd0c216d64299fac759bddefa2c6105fc48388d0691f64b9225952a334`
Tampered: `0x2a624c8c6acf8f9acfbfaa91c79272bd385b8b473cf08f01168ae9899a7c3108`

A change in the fourth decimal place produces a completely unrelated digest.

### What it does and does not prove

**Proves:** this exact record existed no later than the block timestamp, and was
committed by that address. Any modification is detectable.

**Does not prove:** the record was *true* when written. A blockchain anchors
data; it does not validate it. That is the job of the biometric threshold
upstream — which is why the search stage refuses to emit a record at all unless
a face genuinely matched.

---

## 5. Terminal operations

`backend/verify_chain.py` — no frontend, no Python knowledge needed.

```powershell
cd "C:\Tales of Goa\backend"
```

### `status`

```powershell
.\.venv\Scripts\python.exe verify_chain.py status
```

```
  network           : Local Hardhat Node
  chain_id          : 31337
  rpc_url           : http://127.0.0.1:8545
  contract_address  : 0x5FbDB2315678afecb367f032d93F642f64180aa3
  account           : 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
  balance_eth       : 9999.999
  block_number      : 9
  configured        : True
  connected         : True
  live              : True
  message           : Connected to Local Hardhat Node.
```

Exit `0` when `live`, `1` otherwise — usable in scripts.

### `commit`

```powershell
.\.venv\Scripts\python.exe verify_chain.py commit --file record.json
.\.venv\Scripts\python.exe verify_chain.py commit --text "any string to anchor"
```

```
  canonical SHA-256 : 0xa5245c981b194d43825368f2fce73ff97aec078007665cec25f3fac77557e126
  network           : Local Hardhat Node
  simulated         : False
  tx hash           : 0xc6ed622dcc25356bf1ce391d7cd5a20b949529a38b217127bd9f2fc3f37ad452
  block             : 9   gas 90265
  status            : confirmed
```

### `query`

```powershell
.\.venv\Scripts\python.exe verify_chain.py query --hash 0xa5245c98…
```

Present:

```
  exists_on_chain   : True
  recorder          : 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
  timestamp         : 1788635868 (2026-09-05T19:17:48+00:00)
```

Absent:

```
  exists_on_chain   : False
  note              : Record hash not found on-chain.
```

Exit `0` when found, `1` when not.

### `demo` ⭐ — record this one

```powershell
.\.venv\Scripts\python.exe verify_chain.py demo
.\.venv\Scripts\python.exe verify_chain.py demo --file record.json
```

Six steps in one run:

| Step | Shows |
|---|---|
| 1 | The original record |
| 2 | Its canonical SHA-256 fingerprint |
| 3 | Commit — real tx hash, block, gas |
| 4 | Read back via `getVerification` |
| 5 | Re-hash unchanged → identical → **VERIFIED** |
| 6 | Alter one digit → re-hash → absent → **TAMPERED — DETECTED** |

Exits `0` only when both **VERIFIED** and **TAMPERED — DETECTED** hold.

---

## 6. Local Hardhat chain

The default, and the recommended configuration for the recording.

```powershell
# Terminal 1 — leave running
cd "C:\Tales of Goa\blockchain"
npm run node
```

Serves `http://127.0.0.1:8545`, chain id **31337**, 20 accounts pre-funded with
10,000 ETH, instant blocks.

```powershell
# Terminal 2
cd "C:\Tales of Goa\blockchain"
npm run deploy:local
```

```
[Blockchain] Network      : localhost (chainId 31337)
[Blockchain] Deployer     : 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
[Blockchain] Balance      : 10000.0 ETH
[Blockchain] Deployed to  : 0x5FbDB2315678afecb367f032d93F642f64180aa3
[Blockchain] Tx hash      : 0x965ed30e…

Next step — copy these into backend/.env:
  CONTRACT_ADDRESS=0x5FbDB2315678afecb367f032d93F642f64180aa3
  CHAIN_ID=31337
```

On a fresh node the address is **deterministic** — first deployment from
account #0 at nonce 0 is always `0x5FbDB2315678afecb367f032d93F642f64180aa3`.

### `backend/.env`

```
BLOCKCHAIN_RPC_URL=http://127.0.0.1:8545
CHAIN_ID=31337
CONTRACT_ADDRESS=0x5FbDB2315678afecb367f032d93F642f64180aa3
PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

> That key is **Hardhat's published account #0**. It appears in Hardhat's own
> documentation, is identical on every machine, and is worthless outside a local
> node. Safe to show on camera. **Never put a real key here.**

### Why local is a good choice for the demo

- Requirement 3 explicitly permits *"a local/simulated chain"*
- No faucet, no waiting, no rate limits, no network flakiness
- Instant blocks — the recording stays tight
- Real EVM, real transactions, real gas accounting, genuine state

**Limitation:** state is ephemeral. Stopping the node discards all blocks.
Re-deploy and re-commit next session, or use Sepolia for persistence.

---

## 7. Ethereum Sepolia

Public testnet, chain id **11155111**. Gives publicly verifiable Etherscan
links.

### 1 — throwaway wallet

Create a fresh wallet used for nothing else. **Never reuse a key that holds real
funds.**

### 2 — fund it

- <https://sepoliafaucet.com>
- <https://www.alchemy.com/faucets/ethereum-sepolia>

A single drip covers many commits at ~0.0018 ETH each.

### 3 — configure `backend/.env`

```
BLOCKCHAIN_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
CHAIN_ID=11155111
CONTRACT_ADDRESS=
PRIVATE_KEY=<throwaway key>

SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
DEPLOYER_PRIVATE_KEY=<same throwaway key>
ETHERSCAN_API_KEY=<optional>
```

A dedicated Alchemy/Infura endpoint is more reliable than the public one for
deployment.

### 4 — preflight

```powershell
cd blockchain
npm run balance:sepolia
```

```
Network : sepolia (chainId 11155111)
Block   : 11641638
Account : 0x…
Balance : 0.05 ETH
```

Catches a bad RPC URL, a malformed key, or an unfunded account **before** you
spend time on a failed deployment.

### 5 — deploy

```powershell
npm run deploy:sepolia
```

Refuses to proceed with a clear message if the deployer holds 0 ETH. On success
it prints the Etherscan address link. Copy the address into `CONTRACT_ADDRESS`
and restart the backend.

### 6 — optional source verification

```powershell
npx hardhat verify --network sepolia 0x<address>
```

Needs `ETHERSCAN_API_KEY`.

### Sepolia specifics handled in code

| Issue | Handling |
|---|---|
| Oversized `extraData` on PoA-derived chains | `ExtraDataToPOAMiddleware` injected at layer 0 |
| ~12 s block time | Receipt wait raised to **240 s** |
| Slow public RPC | Request timeout **20 s** |
| Fee market | EIP-1559 with `maxFee = 2×baseFee + priority` |

Every transaction response then carries
`explorer_url: https://sepolia.etherscan.io/tx/0x…`.

---

## 8. Simulated mode

When the chain cannot be reached or is not configured, the pipeline still
completes — but the result is flagged.

```json
{
  "success": true,
  "simulated": true,
  "status": "simulated",
  "transaction_hash": "0x3f9c…",
  "network": "Local Hardhat Node (SIMULATED - not broadcast)",
  "block_number": null,
  "explorer_url": null,
  "error": "CONTRACT_ADDRESS is not set in backend/.env — deploy the contract first."
}
```

Triggers: `CONTRACT_ADDRESS` unset · `PRIVATE_KEY` unset · RPC unreachable ·
transaction failed.

### Why it exists, and its guardrails

It keeps the recognition and discovery stages demonstrable without a chain. But
it is **never** presented as a confirmation:

- `simulated: true` propagates through the API into the CLI and the UI
- `block_number` is `null`, not a fabricated number
- `status` is `"simulated"`, not `"confirmed"`
- The reason is carried in `error`
- The UI renders it amber: **"SIMULATED PROOF — NOT BROADCAST ON-CHAIN"**
- `run_pipeline.py` prints a warning and exits `3`
- `verify_chain.py demo` refuses to continue and exits `1`

The original implementation returned `sha256(hash + time)` as a "transaction
hash" with a hardcoded `block_number: 1048291` and `status: "confirmed"` —
indistinguishable from a real transaction in the UI. That is fixed.

**For the submission, run against a live chain.** `status` must show
`live: True` and results must show `simulated: false`.

---

## 9. Transaction construction

`submit_record_hash_to_blockchain()` in `backend/app/services/blockchain.py`.

```python
tx_params = {
    "from":    account.address,
    "nonce":   w3.eth.get_transaction_count(account.address, "pending"),
    "chainId": CHAIN_ID,
    **_build_fee_fields(w3),
}
tx_params["gas"] = int(fn.estimate_gas({"from": account.address}) * 1.25)
```

### Fees

```python
base_fee = w3.eth.get_block("latest").get("baseFeePerGas")
if base_fee is not None:                       # EIP-1559 chain
    priority = w3.eth.max_priority_fee
    return {"maxPriorityFeePerGas": priority,
            "maxFeePerGas": base_fee * 2 + priority}
return {"gasPrice": w3.eth.gas_price}          # legacy chain
```

The `2 × baseFee` headroom keeps the transaction valid across several blocks of
base-fee growth instead of stalling in the mempool.

### Nonce

`"pending"` rather than `"latest"` so back-to-back commits do not collide.

### Gas

`estimate_gas × 1.25`. The call is three `SSTORE`s plus an event, so 90 k with
25 % headroom stays far inside any block limit. Falls back to 120,000 if
estimation fails.

### Receipt

```python
receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=240)
mined_ok = receipt.get("status", 1) == 1
```

`status == 0` is reported as `"reverted"`, not silently as success.

### Reading back

`getVerification` reverts for an unknown hash. The service distinguishes a
legitimate negative from a service failure:

```python
if "not found" in message.lower() or "revert" in message.lower():
    return {**base, "error": "Record hash not found on-chain."}
```

So "absent" is data, not an exception.

---

## 10. Contract tests

```powershell
cd "C:\Tales of Goa\blockchain"
npm test
```

```
  FaceVerification Smart Contract
    ✔ Should record a biometric verification hash and emit VerificationRecorded event
    ✔ Should reject zero bytes32 hash
    ✔ Should revert when querying a hash that was never recorded

  3 passing
```

| Test | Asserts |
|---|---|
| Record + event | Event fires with the right hash and recorder; the stored timestamp equals the **mined block's** timestamp |
| Zero hash | Reverts with `"Invalid record hash"` |
| Unknown hash | Reverts with `"Record hash not found"` |

### A flaky test that was fixed

The original predicted the mining timestamp:

```js
.withArgs(sampleHash, await ethers.provider.getBlock('latest')
          .then(b => b.timestamp + 1), owner.address)
```

`latest + 1` guesses the next block's timestamp and loses whenever the node
clock ticks between the read and the mine — an intermittent
`expected 1788622110 to equal 1788622111`. It now matches loosely with
`anyValue` and pins the value against the receipt's actual block:

```js
const receipt = await tx.wait();
const minedBlock = await ethers.provider.getBlock(receipt.blockNumber);
expect(record.timestamp).to.equal(minedBlock.timestamp);
```

Stronger *and* deterministic.

---

## 11. Blockchain troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `simulated: true` on every commit | Contract/key unset, or RPC down | `verify_chain.py status` and read `message` |
| `live: false`, `connected: true` | Address set but account has 0 ETH | Fund it, or switch to the local chain |
| `Cannot reach RPC endpoint` | Hardhat node not running | `cd blockchain; npm run node` |
| `exists_on_chain: false` for a record you committed | Node restarted — local state is ephemeral | Re-deploy and re-commit |
| `Record hash not found` after switching chains | The contract lives on the other chain | Re-deploy on the new chain, update `CONTRACT_ADDRESS` |
| `nonce too low` | Competing sender using the same key | Use one signer, or wait for the pending tx |
| `insufficient funds for gas` | Deployer unfunded on Sepolia | Faucet, then `npm run balance:sepolia` |
| Deploy succeeds, backend still simulates | `.env` not updated, or backend not restarted | Paste the address, restart the backend |
| `extraData` / PoA errors | Missing middleware | Already handled — check `web3` is current |
| Receipt timeout on Sepolia | Congestion or low fee | Retry; fees already carry 2× base headroom |

### Confirming a real transaction

```powershell
# 1. chain reachable, configured, funded
.\.venv\Scripts\python.exe verify_chain.py status        # live : True

# 2. commit and read it straight back
.\.venv\Scripts\python.exe verify_chain.py demo          # VERIFIED + TAMPERED DETECTED
```

If both pass, the blockchain requirement is fully demonstrated.

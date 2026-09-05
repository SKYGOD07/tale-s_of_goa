import os
import time
import hashlib
from datetime import datetime, timezone
from typing import Dict, Any, Optional
from web3 import Web3
from dotenv import load_dotenv

load_dotenv()

# Environment variables
RPC_URL = os.getenv("BLOCKCHAIN_RPC_URL", "http://127.0.0.1:8545")
CONTRACT_ADDRESS = os.getenv("CONTRACT_ADDRESS", "").strip()
PRIVATE_KEY = os.getenv("PRIVATE_KEY", "").strip()
CHAIN_ID = int(os.getenv("CHAIN_ID", "11155111"))

# Public RPC endpoints are an order of magnitude slower than a local node, and a
# Sepolia block lands roughly every 12s - the timeouts have to reflect that.
RPC_TIMEOUT_SECONDS = 20
RECEIPT_TIMEOUT_SECONDS = 240

CHAIN_NAMES = {
    1: "Ethereum Mainnet",
    11155111: "Ethereum Sepolia Testnet",
    17000: "Ethereum Holesky Testnet",
    31337: "Local Hardhat Node",
}

EXPLORERS = {
    1: "https://etherscan.io",
    11155111: "https://sepolia.etherscan.io",
    17000: "https://holesky.etherscan.io",
}

# Minimal ABI for FaceVerification.sol
CONTRACT_ABI = [
    {
        "inputs": [{"internalType": "bytes32", "name": "recordHash", "type": "bytes32"}],
        "name": "recordVerification",
        "outputs": [{"internalType": "bool", "name": "", "type": "bool"}],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [{"internalType": "bytes32", "name": "recordHash", "type": "bytes32"}],
        "name": "getVerification",
        "outputs": [
            {"internalType": "uint256", "name": "timestamp", "type": "uint256"},
            {"internalType": "address", "name": "recorder", "type": "address"}
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "anonymous": False,
        "inputs": [
            {"indexed": True, "internalType": "bytes32", "name": "recordHash", "type": "bytes32"},
            {"indexed": False, "internalType": "uint256", "name": "timestamp", "type": "uint256"},
            {"indexed": True, "internalType": "address", "name": "recorder", "type": "address"}
        ],
        "name": "VerificationRecorded",
        "type": "event"
    }
]


def network_name(chain_id: int = CHAIN_ID) -> str:
    return CHAIN_NAMES.get(chain_id, f"EVM Chain {chain_id}")


def explorer_tx_url(tx_hash: str, chain_id: int = CHAIN_ID) -> Optional[str]:
    base = EXPLORERS.get(chain_id)
    return f"{base}/tx/{tx_hash}" if base else None


def explorer_address_url(address: str, chain_id: int = CHAIN_ID) -> Optional[str]:
    base = EXPLORERS.get(chain_id)
    return f"{base}/address/{address}" if base else None


def get_web3() -> Optional[Web3]:
    """Connected Web3 instance, or None when the RPC endpoint is unreachable."""
    try:
        w3 = Web3(Web3.HTTPProvider(RPC_URL, request_kwargs={"timeout": RPC_TIMEOUT_SECONDS}))
        # Sepolia blocks carry an oversized extraData field that the default
        # block validator rejects; the POA middleware tolerates it.
        try:
            from web3.middleware import ExtraDataToPOAMiddleware
            w3.middleware_onion.inject(ExtraDataToPOAMiddleware, layer=0)
        except ImportError:
            from web3.middleware import geth_poa_middleware
            w3.middleware_onion.inject(geth_poa_middleware, layer=0)
        return w3 if w3.is_connected() else None
    except Exception as e:
        print(f"[Blockchain] RPC connection to {RPC_URL} failed: {e}")
        return None


def chain_status() -> Dict[str, Any]:
    """Diagnostics for the /api/verification/status endpoint and the UI chain badge."""
    info: Dict[str, Any] = {
        "chain_id": CHAIN_ID,
        "network": network_name(),
        "rpc_url": RPC_URL,
        "contract_address": CONTRACT_ADDRESS or None,
        "explorer_url": explorer_address_url(CONTRACT_ADDRESS) if CONTRACT_ADDRESS else None,
        "configured": bool(CONTRACT_ADDRESS and PRIVATE_KEY),
        "connected": False,
        "live": False,
        "account": None,
        "balance_eth": None,
        "block_number": None,
        "message": "",
    }

    w3 = get_web3()
    if w3 is None:
        info["message"] = f"Cannot reach RPC endpoint {RPC_URL}."
        return info

    info["connected"] = True
    try:
        info["block_number"] = w3.eth.block_number
    except Exception:
        pass

    if not CONTRACT_ADDRESS:
        info["message"] = "CONTRACT_ADDRESS is not set. Deploy with `npm run deploy:sepolia` in blockchain/, then copy the address into backend/.env."
        return info

    if not PRIVATE_KEY:
        info["message"] = "PRIVATE_KEY is not set in backend/.env, so transactions cannot be signed."
        return info

    try:
        account = w3.eth.account.from_key(PRIVATE_KEY)
        balance_wei = w3.eth.get_balance(account.address)
        info["account"] = account.address
        info["balance_eth"] = float(w3.from_wei(balance_wei, "ether"))
        if balance_wei == 0:
            info["message"] = f"Account {account.address} holds 0 ETH on {network_name()}. Fund it from a Sepolia faucet."
        else:
            info["live"] = True
            info["message"] = f"Connected to {network_name()}."
    except Exception as e:
        info["message"] = f"Signing account could not be loaded: {e}"

    return info


def format_bytes32_hash(record_hash_hex: str) -> str:
    """Formats 64-hex char SHA-256 string into standard 0x-prefixed 32-byte hex string."""
    cleaned = record_hash_hex.strip()
    if cleaned.startswith("0x") or cleaned.startswith("0X"):
        cleaned = cleaned[2:]
    if len(cleaned) < 64:
        cleaned = cleaned.zfill(64)
    elif len(cleaned) > 64:
        cleaned = cleaned[:64]
    return "0x" + cleaned


def _simulated_result(bytes32_hash: str, reason: str) -> Dict[str, Any]:
    """
    Offline fallback so the pipeline still runs end-to-end without a funded
    testnet account. It is flagged `simulated: True` and carries the reason, so
    the UI can show it as a dry run rather than a confirmed on-chain proof.
    """
    simulated_tx = hashlib.sha256(f"{bytes32_hash}{time.time()}".encode()).hexdigest()
    return {
        "success": True,
        "simulated": True,
        "record_hash": bytes32_hash,
        "transaction_hash": f"0x{simulated_tx}",
        "network": f"{network_name()} (SIMULATED - not broadcast)",
        "chain_id": CHAIN_ID,
        "status": "simulated",
        "explorer_url": None,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "block_number": None,
        "error": reason,
    }


def _build_fee_fields(w3: Web3) -> Dict[str, Any]:
    """EIP-1559 fees where the chain supports them, legacy gasPrice otherwise."""
    try:
        base_fee = w3.eth.get_block("latest").get("baseFeePerGas")
        if base_fee is not None:
            priority = w3.eth.max_priority_fee
            return {
                "maxPriorityFeePerGas": priority,
                # 2x base-fee headroom keeps the tx valid across a few blocks of
                # base-fee growth instead of stalling in the mempool.
                "maxFeePerGas": base_fee * 2 + priority,
            }
    except Exception:
        pass
    return {"gasPrice": w3.eth.gas_price}


def submit_record_hash_to_blockchain(record_hash_hex: str) -> Dict[str, Any]:
    """
    Submits the SHA-256 record hash to the smart contract via recordVerification(bytes32).
    """
    bytes32_hash = format_bytes32_hash(record_hash_hex)

    if not CONTRACT_ADDRESS:
        return _simulated_result(bytes32_hash, "CONTRACT_ADDRESS is not set in backend/.env - deploy the contract first.")
    if not PRIVATE_KEY:
        return _simulated_result(bytes32_hash, "PRIVATE_KEY is not set in backend/.env - cannot sign transactions.")

    w3 = get_web3()
    if w3 is None:
        return _simulated_result(bytes32_hash, f"RPC endpoint {RPC_URL} is unreachable.")

    try:
        account = w3.eth.account.from_key(PRIVATE_KEY)
        contract = w3.eth.contract(
            address=Web3.to_checksum_address(CONTRACT_ADDRESS),
            abi=CONTRACT_ABI,
        )

        fn = contract.functions.recordVerification(bytes32_hash)
        tx_params: Dict[str, Any] = {
            "from": account.address,
            "nonce": w3.eth.get_transaction_count(account.address, "pending"),
            "chainId": CHAIN_ID,
            **_build_fee_fields(w3),
        }

        try:
            # 25% headroom over the estimate; the call is one SSTORE plus an
            # event, so this stays far inside a normal block gas limit.
            tx_params["gas"] = int(fn.estimate_gas({"from": account.address}) * 1.25)
        except Exception:
            tx_params["gas"] = 120000

        tx = fn.build_transaction(tx_params)
        signed_tx = w3.eth.account.sign_transaction(tx, private_key=PRIVATE_KEY)
        raw_tx = getattr(signed_tx, "raw_transaction", None) or getattr(signed_tx, "rawTransaction", None)

        tx_hash = w3.eth.send_raw_transaction(raw_tx)
        tx_hash_hex = w3.to_hex(tx_hash)
        print(f"[Blockchain] Broadcast {tx_hash_hex} on {network_name()} - awaiting receipt...")

        receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=RECEIPT_TIMEOUT_SECONDS)
        mined_ok = receipt.get("status", 1) == 1

        return {
            "success": mined_ok,
            "simulated": False,
            "record_hash": bytes32_hash,
            "transaction_hash": tx_hash_hex,
            "network": network_name(),
            "chain_id": CHAIN_ID,
            "status": "confirmed" if mined_ok else "reverted",
            "explorer_url": explorer_tx_url(tx_hash_hex),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "block_number": receipt.get("blockNumber"),
            "gas_used": receipt.get("gasUsed"),
            "error": None if mined_ok else "Transaction reverted on-chain.",
        }

    except Exception as e:
        print(f"[Blockchain] Live submission failed: {e}")
        return _simulated_result(bytes32_hash, f"Live submission failed: {e}")


def query_verification_record(record_hash_hex: str) -> Dict[str, Any]:
    """
    Queries the smart contract via getVerification(bytes32) to confirm a proof exists.
    """
    bytes32_hash = format_bytes32_hash(record_hash_hex)

    base = {
        "record_hash": bytes32_hash,
        "exists_on_chain": False,
        "network": network_name(),
        "chain_id": CHAIN_ID,
        "simulated": False,
        "explorer_url": None,
    }

    if not CONTRACT_ADDRESS:
        return {**base, "simulated": True, "error": "CONTRACT_ADDRESS is not set in backend/.env - deploy the contract first."}

    w3 = get_web3()
    if w3 is None:
        return {**base, "simulated": True, "error": f"RPC endpoint {RPC_URL} is unreachable."}

    try:
        contract = w3.eth.contract(
            address=Web3.to_checksum_address(CONTRACT_ADDRESS),
            abi=CONTRACT_ABI,
        )
        ts, recorder = contract.functions.getVerification(bytes32_hash).call()
        if ts > 0:
            return {
                **base,
                "exists_on_chain": True,
                "timestamp": ts,
                "timestamp_iso": datetime.fromtimestamp(ts, tz=timezone.utc).isoformat(),
                "recorder": recorder,
                "explorer_url": explorer_address_url(CONTRACT_ADDRESS),
            }
        return {**base, "error": "Record hash not found on-chain."}
    except Exception as e:
        # getVerification reverts with "Record hash not found" for unknown
        # hashes, which is a legitimate negative answer, not a service failure.
        message = str(e)
        if "not found" in message.lower() or "revert" in message.lower():
            return {**base, "error": "Record hash not found on-chain."}
        print(f"[Blockchain] Query failed: {e}")
        return {**base, "error": f"Query failed: {message}"}

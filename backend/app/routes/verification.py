from fastapi import APIRouter, HTTPException, status
from app.schemas.face import (
    VerificationRequest,
    VerificationResponse,
    VerificationQueryResponse,
    ChainStatusResponse,
)
from app.services.blockchain import (
    submit_record_hash_to_blockchain,
    query_verification_record,
    chain_status,
    network_name,
    CHAIN_ID,
)

router = APIRouter(prefix="/api/verification", tags=["Blockchain Verification"])


@router.get("/status", response_model=ChainStatusResponse)
def chain_status_endpoint():
    """
    GET /api/verification/status
    Reports which chain the backend is pointed at, whether the RPC endpoint is
    reachable, and whether the signing account is funded enough to broadcast.
    """
    return ChainStatusResponse(**chain_status())


@router.post("/record", response_model=VerificationResponse)
def record_verification_endpoint(payload: VerificationRequest):
    """
    POST /api/verification/record
    Submits the canonical biometric record hash to the EVM smart contract.
    """
    try:
        print(f"[BLOCKCHAIN] Submitting record hash to {network_name()}: {payload.record_hash}")
        result = submit_record_hash_to_blockchain(payload.record_hash)
        if result.get("simulated"):
            print(f"[BLOCKCHAIN] SIMULATED (not broadcast): {result.get('error')}")
        else:
            print(f"[BLOCKCHAIN] Confirmed in block {result.get('block_number')}: {result['transaction_hash']}")
        return VerificationResponse(**result)
    except Exception as e:
        print(f"[ERROR][BLOCKCHAIN] Verification recording failed: {e}")
        return VerificationResponse(
            success=False,
            record_hash=payload.record_hash,
            transaction_hash="",
            network=network_name(),
            chain_id=CHAIN_ID,
            status="failed",
            timestamp="",
            error=str(e),
        )


@router.get("/query/{record_hash}", response_model=VerificationQueryResponse)
def query_verification_endpoint(record_hash: str):
    """
    GET /api/verification/query/{record_hash}
    Queries the EVM smart contract for an existing on-chain biometric proof.
    """
    try:
        print(f"[BLOCKCHAIN] Querying smart contract for record hash: {record_hash}")
        result = query_verification_record(record_hash)
        return VerificationQueryResponse(**result)
    except Exception as e:
        print(f"[ERROR][BLOCKCHAIN] Query failed: {e}")
        return VerificationQueryResponse(
            record_hash=record_hash,
            exists_on_chain=False,
            network=network_name(),
            chain_id=CHAIN_ID,
            error=str(e),
        )

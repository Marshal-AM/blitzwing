"""Hedera EVM escrow release (Phase 2). Falls back to native treasury when not configured."""

from __future__ import annotations

import hashlib
import json
import logging
import urllib.error
import urllib.request
from typing import Any, Dict, List, Optional

from orchestrator.app.config import Settings
from orchestrator.app.hedera_jvm import big_integers, ensure_java_vm
from orchestrator.app.registry import HostRecord

logger = logging.getLogger(__name__)


def request_id_to_bytes32(request_id: str) -> bytes:
    return hashlib.sha256(request_id.encode("utf-8")).digest()


def resolve_evm_address(account_id: str, *, network: str = "hedera-testnet") -> str:
    """
    Resolve the EVM address Hedera contracts should send to.

    ECDSA accounts must use their alias address (mirror ``evm_address``), not the
    long-zero encoding from AccountId.toSolidityAddress() — contract value
    transfers to long-zero often revert for those accounts.
    """
    host = (
        "mainnet-public.mirrornode.hedera.com"
        if "mainnet" in network.lower()
        else "testnet.mirrornode.hedera.com"
    )
    url = f"https://{host}/api/v1/accounts/{account_id}"
    try:
        with urllib.request.urlopen(url, timeout=20) as resp:
            data = json.loads(resp.read().decode())
        evm = (data.get("evm_address") or "").strip()
        if evm:
            if not evm.startswith("0x"):
                evm = f"0x{evm}"
            return evm
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, KeyError) as exc:
        logger.warning(
            "Mirror EVM lookup failed for %s: %s — falling back to long-zero",
            account_id,
            exc,
        )

    from hedera import AccountId

    addr = AccountId.fromString(account_id).toSolidityAddress()
    if not str(addr).startswith("0x"):
        addr = f"0x{addr}"
    return str(addr)


class HederaEscrowService:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    @property
    def enabled(self) -> bool:
        return bool(self.settings.escrow_contract_id and self.settings.escrow_evm_address)

    def release(
        self,
        request_id: str,
        hosts: List[HostRecord],
        cost_per_layer: int,
    ) -> Optional[Dict[str, Any]]:
        if not self.enabled:
            return None
        ensure_java_vm()
        try:
            from hedera import (
                AccountId,
                Client,
                ContractExecuteTransaction,
                ContractFunctionParameters,
                ContractId,
                Hbar,
                PrivateKey,
            )
        except ImportError as exc:  # pragma: no cover
            raise RuntimeError("hedera-sdk-py required for escrow release") from exc

        recipients: List[str] = []
        amounts: List[int] = []
        host_rows: List[Dict[str, Any]] = []
        for host in hosts:
            if not host.hedera_account_id or host.layers_hosted <= 0:
                continue
            amount = host.layers_hosted * cost_per_layer
            if amount <= 0:
                continue
            recipients.append(host.hedera_account_id)
            amounts.append(amount)
            host_rows.append(
                {
                    "host_id": host.host_id,
                    "hedera_account_id": host.hedera_account_id,
                    "layers": host.layers_hosted,
                    "amount_tinybars": amount,
                }
            )
        if not recipients:
            return None

        network = (self.settings.hedera_network or "hedera-testnet").lower()
        client = Client.forTestnet() if "testnet" in network else Client.forMainnet()
        key_raw = (self.settings.escrow_operator_private_key or "").replace("0x", "")
        private_key = PrivateKey.fromStringECDSA(key_raw)
        operator_id = AccountId.fromString(self.settings.mother_account_id)
        client.setOperator(operator_id, private_key)

        params = ContractFunctionParameters()
        params.addBytes32(request_id_to_bytes32(request_id))
        solidity_addrs = [resolve_evm_address(r, network=network) for r in recipients]
        logger.info(
            "Escrow release recipients=%s amounts=%s",
            list(zip(recipients, solidity_addrs)),
            amounts,
        )
        params.addAddressArray(solidity_addrs)
        params.addUint256Array(big_integers(amounts))

        contract_id = ContractId.fromString(self.settings.escrow_contract_id)
        tx = (
            ContractExecuteTransaction()
            .setContractId(contract_id)
            .setGas(2_000_000)
            .setFunction("release", params)
            .setMaxTransactionFee(Hbar.fromTinybars(500_000_000))
        )
        resp = tx.execute(client)
        receipt = resp.getReceipt(client)
        tx_id = (
            resp.transactionId.toString()
            if hasattr(resp.transactionId, "toString")
            else str(resp.transactionId)
        )
        logger.info("Escrow release tx=%s status=%s", tx_id, receipt.status)
        for row, addr in zip(host_rows, solidity_addrs):
            row["evm_address"] = addr
        return {
            "request_id": request_id,
            "payout_tx_id": tx_id,
            "escrow_contract_id": self.settings.escrow_contract_id,
            "total_tinybars": sum(amounts),
            "hosts": host_rows,
        }


_escrow: Optional[HederaEscrowService] = None


def get_escrow_service(settings: Optional[Settings] = None) -> HederaEscrowService:
    global _escrow
    # Always rebuild when settings change (e.g. escrow redeploy updates .env).
    from orchestrator.app.config import get_settings

    current = settings or get_settings()
    if _escrow is None or _escrow.settings.escrow_contract_id != current.escrow_contract_id:
        _escrow = HederaEscrowService(current)
    return _escrow

"""Hedera EVM escrow release (Phase 2). Falls back to native treasury when not configured."""

from __future__ import annotations

import hashlib
import logging
from typing import Any, Dict, List, Optional

from orchestrator.app.config import Settings
from orchestrator.app.registry import HostRecord

logger = logging.getLogger(__name__)


def request_id_to_bytes32(request_id: str) -> bytes:
    return hashlib.sha256(request_id.encode("utf-8")).digest()


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
        params.addAddressArray(
            [AccountId.fromString(r).toSolidityAddress() for r in recipients]
        )
        params.addUint256Array(amounts)

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
        tx_id = str(resp.transactionId)
        logger.info("Escrow release tx=%s status=%s", tx_id, receipt.status)
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
    if _escrow is None:
        from orchestrator.app.config import get_settings

        _escrow = HederaEscrowService(settings or get_settings())
    return _escrow

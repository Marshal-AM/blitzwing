"""Post-inference HBAR redistribution + HCS audit log."""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional

from orchestrator.app.config import Settings
from orchestrator.app.registry import HostRecord

logger = logging.getLogger(__name__)


@dataclass
class HostPayout:
    host_id: str
    hedera_account_id: str
    layers: int
    amount_tinybars: int


@dataclass
class PayoutReceipt:
    request_id: str
    x402_tx_id: Optional[str]
    payout_tx_id: Optional[str]
    hcs_topic_id: Optional[str]
    hcs_sequence: Optional[str]
    cost_per_layer_tinybars: int
    total_tinybars: int
    hosts: List[Dict[str, Any]]


class HederaPayoutService:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._client = None
        self._topic_id = settings.hcs_topic_id

    @property
    def enabled(self) -> bool:
        return bool(
            self.settings.x402_enabled
            and self.settings.mother_account_id
            and self.settings.mother_private_key
            and self.settings.cost_per_layer_tinybars > 0
        )

    def _ensure_client(self):
        if self._client is not None:
            return self._client
        try:
            from hedera import AccountId, Client, PrivateKey
        except ImportError as exc:  # pragma: no cover
            raise RuntimeError(
                "hedera-sdk-py is required for payouts. pip install hedera-sdk-py"
            ) from exc

        network = (self.settings.hedera_network or "hedera-testnet").lower()
        if "mainnet" in network:
            client = Client.forMainnet()
        else:
            client = Client.forTestnet()

        key_raw = self.settings.mother_private_key or ""
        if key_raw.startswith("0x"):
            key_raw = key_raw[2:]
        try:
            private_key = PrivateKey.fromStringECDSA(key_raw)
        except Exception:
            private_key = PrivateKey.fromString(key_raw)
        account_id = AccountId.fromString(self.settings.mother_account_id)
        client.setOperator(account_id, private_key)
        self._client = client
        return client

    def _persist_topic_id(self, topic_id: str) -> None:
        self._topic_id = topic_id
        # Best-effort local persistence for subsequent boots
        path = Path.home() / ".blitzwing" / "hcs_topic_id"
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(topic_id + "\n", encoding="utf-8")
            os.environ["HCS_TOPIC_ID"] = topic_id
        except Exception:  # noqa: BLE001
            logger.exception("Failed to persist HCS topic id")

    def ensure_hcs_topic(self) -> Optional[str]:
        if not self.enabled:
            return None
        if self._topic_id:
            return self._topic_id
        persisted = Path.home() / ".blitzwing" / "hcs_topic_id"
        if persisted.exists():
            tid = persisted.read_text(encoding="utf-8").strip()
            if tid:
                self._topic_id = tid
                return tid

        from hedera import TopicCreateTransaction

        client = self._ensure_client()
        tx = TopicCreateTransaction().setTopicMemo("blitzwing-payouts")
        resp = tx.execute(client)
        receipt = resp.getReceipt(client)
        topic_id = str(receipt.topicId)
        logger.info("Created HCS topic %s", topic_id)
        self._persist_topic_id(topic_id)
        return topic_id

    def plan_payouts(self, hosts: List[HostRecord]) -> List[HostPayout]:
        cpl = int(self.settings.cost_per_layer_tinybars)
        out: List[HostPayout] = []
        for h in hosts:
            if not h.hedera_account_id or h.layers_hosted <= 0:
                continue
            out.append(
                HostPayout(
                    host_id=h.host_id,
                    hedera_account_id=h.hedera_account_id,
                    layers=h.layers_hosted,
                    amount_tinybars=h.layers_hosted * cpl,
                )
            )
        return out

    def redistribute(
        self,
        *,
        request_id: str,
        hosts: List[HostRecord],
        x402_tx_id: Optional[str] = None,
    ) -> PayoutReceipt:
        from orchestrator.app.hedera_escrow import get_escrow_service

        escrow_svc = get_escrow_service(self.settings)
        if escrow_svc.enabled:
            escrow_out = escrow_svc.release(
                request_id, hosts, int(self.settings.cost_per_layer_tinybars)
            )
            if escrow_out:
                topic_id = self.ensure_hcs_topic()
                hcs_seq: Optional[str] = None
                if topic_id:
                    from hedera import TopicId, TopicMessageSubmitTransaction

                    client = self._ensure_client()
                    payload = {
                        "requestId": request_id,
                        "x402TxId": x402_tx_id,
                        "payoutTxId": escrow_out.get("payout_tx_id"),
                        "escrowContractId": escrow_out.get("escrow_contract_id"),
                        "costPerLayerTinybars": self.settings.cost_per_layer_tinybars,
                        "hosts": escrow_out.get("hosts", []),
                    }
                    msg = TopicMessageSubmitTransaction().setTopicId(
                        TopicId.fromString(topic_id)
                    ).setMessage(json.dumps(payload, separators=(",", ":")))
                    msg_resp = msg.execute(client)
                    msg_receipt = msg_resp.getReceipt(client)
                    hcs_seq = str(getattr(msg_receipt, "topicSequenceNumber", None))
                return PayoutReceipt(
                    request_id=request_id,
                    x402_tx_id=x402_tx_id,
                    payout_tx_id=escrow_out.get("payout_tx_id"),
                    hcs_topic_id=topic_id,
                    hcs_sequence=hcs_seq,
                    cost_per_layer_tinybars=self.settings.cost_per_layer_tinybars,
                    total_tinybars=int(escrow_out.get("total_tinybars", 0)),
                    hosts=escrow_out.get("hosts", []),
                )

        if not self.enabled:
            return PayoutReceipt(
                request_id=request_id,
                x402_tx_id=x402_tx_id,
                payout_tx_id=None,
                hcs_topic_id=self._topic_id,
                hcs_sequence=None,
                cost_per_layer_tinybars=self.settings.cost_per_layer_tinybars,
                total_tinybars=0,
                hosts=[],
            )

        from hedera import (
            AccountId,
            Hbar,
            TopicMessageSubmitTransaction,
            TransferTransaction,
        )

        client = self._ensure_client()
        mother = AccountId.fromString(self.settings.mother_account_id)
        planned = self.plan_payouts(hosts)
        # Skip no-op credits back to mother treasury
        transfers = [
            p
            for p in planned
            if p.hedera_account_id != self.settings.mother_account_id and p.amount_tinybars > 0
        ]
        total = sum(p.amount_tinybars for p in transfers)
        payout_tx_id: Optional[str] = None

        if total > 0:
            tx = TransferTransaction().addHbarTransfer(mother, Hbar.fromTinybars(-total))
            for p in transfers:
                tx = tx.addHbarTransfer(
                    AccountId.fromString(p.hedera_account_id),
                    Hbar.fromTinybars(p.amount_tinybars),
                )
            resp = tx.execute(client)
            receipt = resp.getReceipt(client)
            payout_tx_id = str(resp.transactionId)
            logger.info(
                "Redistributed %s tinybars to %s hosts tx=%s status=%s",
                total,
                len(transfers),
                payout_tx_id,
                receipt.status,
            )

        topic_id = self.ensure_hcs_topic()
        hcs_seq: Optional[str] = None
        host_rows = [
            {
                "host_id": p.host_id,
                "hedera_account_id": p.hedera_account_id,
                "layers": p.layers,
                "amount_tinybars": p.amount_tinybars,
            }
            for p in planned
        ]
        if topic_id:
            from hedera import TopicId

            payload = {
                "requestId": request_id,
                "x402TxId": x402_tx_id,
                "payoutTxId": payout_tx_id,
                "costPerLayerTinybars": self.settings.cost_per_layer_tinybars,
                "hosts": host_rows,
            }
            msg = TopicMessageSubmitTransaction().setTopicId(TopicId.fromString(topic_id)).setMessage(
                json.dumps(payload, separators=(",", ":"))
            )
            msg_resp = msg.execute(client)
            msg_receipt = msg_resp.getReceipt(client)
            hcs_seq = str(getattr(msg_receipt, "topicSequenceNumber", None))
            logger.info("HCS audit logged topic=%s seq=%s", topic_id, hcs_seq)

        return PayoutReceipt(
            request_id=request_id,
            x402_tx_id=x402_tx_id,
            payout_tx_id=payout_tx_id,
            hcs_topic_id=topic_id,
            hcs_sequence=hcs_seq,
            cost_per_layer_tinybars=self.settings.cost_per_layer_tinybars,
            total_tinybars=sum(p.amount_tinybars for p in planned),
            hosts=host_rows,
        )

    def receipt_dict(self, receipt: PayoutReceipt) -> Dict[str, Any]:
        return {
            "request_id": receipt.request_id,
            "x402_tx_id": receipt.x402_tx_id,
            "payout_tx_id": receipt.payout_tx_id,
            "hcs_topic_id": receipt.hcs_topic_id,
            "hcs_sequence": receipt.hcs_sequence,
            "cost_per_layer_tinybars": receipt.cost_per_layer_tinybars,
            "total_tinybars": receipt.total_tinybars,
            "hosts": receipt.hosts,
        }


_payouts: Optional[HederaPayoutService] = None


def get_payout_service(settings: Optional[Settings] = None) -> HederaPayoutService:
    global _payouts
    if _payouts is None:
        from orchestrator.app.config import get_settings

        _payouts = HederaPayoutService(settings or get_settings())
    return _payouts

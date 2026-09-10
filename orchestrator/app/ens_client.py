"""HTTP client for packages/ens-service + payout verification."""

from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx

from orchestrator.app.config import Settings, get_settings
from orchestrator.app.registry import HostRecord

logger = logging.getLogger(__name__)

_VERIFY_CACHE: Dict[str, tuple[bool, float]] = {}
_VERIFY_TTL_SECONDS = 30.0


@dataclass
class EnsProvisionResult:
    ens_name: str
    tx_hashes: List[str]


class EnsClientError(RuntimeError):
    def __init__(self, message: str, *, retryable: bool = True) -> None:
        super().__init__(message)
        self.retryable = retryable


def _pending_path() -> Path:
    return Path.home() / ".blitzwing" / "ens_pending.json"


def _load_pending() -> List[Dict[str, Any]]:
    path = _pending_path()
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return list(data.get("ops", []))
    except Exception:  # noqa: BLE001
        logger.exception("Failed to load ENS pending ops")
        return []


def _save_pending(ops: List[Dict[str, Any]]) -> None:
    path = _pending_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"ops": ops}, indent=2), encoding="utf-8")


def _enqueue_pending(op: Dict[str, Any]) -> None:
    ops = _load_pending()
    ops.append({**op, "ts": int(time.time())})
    _save_pending(ops)


def _clear_pending_matching(**match: Any) -> None:
    ops = _load_pending()
    kept = [o for o in ops if not all(o.get(k) == v for k, v in match.items())]
    _save_pending(kept)


class EnsServiceClient:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.base = settings.ens_service_url.rstrip("/")

    @property
    def enabled(self) -> bool:
        return bool(self.settings.ens_enabled)

    def _post(self, path: str, payload: Dict[str, Any], timeout: float = 180.0) -> Dict[str, Any]:
        url = f"{self.base}{path}"
        try:
            with httpx.Client(timeout=timeout) as client:
                resp = client.post(url, json=payload)
        except httpx.RequestError as exc:
            raise EnsClientError(f"ENS service unreachable at {url}: {exc}", retryable=True) from exc
        try:
            body = resp.json()
        except Exception:
            body = {"error": resp.text}
        if resp.status_code >= 400:
            err = body.get("error", resp.text)
            retryable = bool(body.get("retryable", True))
            raise EnsClientError(f"ENS {path} failed: {err}", retryable=retryable)
        return body

    def _get(self, path: str, params: Dict[str, str], timeout: float = 60.0) -> Dict[str, Any]:
        url = f"{self.base}{path}"
        try:
            with httpx.Client(timeout=timeout) as client:
                resp = client.get(url, params=params)
        except httpx.RequestError as exc:
            raise EnsClientError(f"ENS service unreachable at {url}: {exc}", retryable=True) from exc
        try:
            body = resp.json()
        except Exception:
            body = {"error": resp.text}
        if resp.status_code == 404:
            return body
        if resp.status_code >= 400:
            err = body.get("error", resp.text)
            raise EnsClientError(f"ENS {path} failed: {err}", retryable=True)
        return body

    def health(self) -> Dict[str, Any]:
        with httpx.Client(timeout=10.0) as client:
            resp = client.get(f"{self.base}/health")
            resp.raise_for_status()
            return resp.json()

    def provision_host(self, host: HostRecord) -> EnsProvisionResult:
        payload = {
            "hostId": host.host_id,
            "role": host.role,
            "hederaAccountId": host.hedera_account_id,
            "blockIndices": host.block_indices,
            "layersHosted": host.layers_hosted,
            "model": host.model,
            "status": host.status if host.status in ("online", "offline") else "online",
        }
        body = self._post("/v1/hosts/provision", payload)
        ens_name = str(body.get("ensName", ""))
        if not ens_name:
            raise EnsClientError("ENS provision returned no ensName", retryable=True)
        tx_hashes = list(body.get("txHashes") or [])
        logger.info(
            "ens_provision host_id=%s ens_name=%s tx_hashes=%s",
            host.host_id,
            ens_name,
            tx_hashes,
        )
        _clear_pending_matching(hostId=host.host_id, action="provision")
        return EnsProvisionResult(ens_name=ens_name, tx_hashes=tx_hashes)

    def update_host(
        self,
        ens_name: str,
        *,
        host_id: Optional[str] = None,
        hedera_account_id: Optional[str] = None,
        block_indices: Optional[str] = None,
        layers_hosted: Optional[int] = None,
        model: Optional[str] = None,
        role: Optional[str] = None,
        status: Optional[str] = None,
    ) -> List[str]:
        payload: Dict[str, Any] = {"ensName": ens_name}
        if host_id is not None:
            payload["hostId"] = host_id
        if hedera_account_id is not None:
            payload["hederaAccountId"] = hedera_account_id
        if block_indices is not None:
            payload["blockIndices"] = block_indices
        if layers_hosted is not None:
            payload["layersHosted"] = layers_hosted
        if model is not None:
            payload["model"] = model
        if role is not None:
            payload["role"] = role
        if status is not None:
            payload["status"] = status
        body = self._post("/v1/hosts/update", payload)
        tx_hashes = list(body.get("txHashes") or [])
        logger.info("ens_update ens_name=%s tx_hashes=%s", ens_name, tx_hashes)
        return tx_hashes

    def deactivate_host(self, ens_name: str) -> List[str]:
        body = self._post("/v1/hosts/deactivate", {"ensName": ens_name})
        tx_hashes = list(body.get("txHashes") or [])
        logger.info("ens_deactivate ens_name=%s tx_hashes=%s", ens_name, tx_hashes)
        return tx_hashes

    def resolve(self, ens_name: str) -> Optional[Dict[str, Any]]:
        body = self._get("/v1/hosts/resolve", {"name": ens_name})
        return body.get("record")

    def verify_host(self, host: HostRecord) -> bool:
        if not self.enabled:
            return True
        if not host.ens_name:
            if self.settings.ens_strict:
                logger.warning("ens_verify_failed host_id=%s reason=no_ens_name", host.host_id)
                return False
            return True

        cached = _VERIFY_CACHE.get(host.host_id)
        now = time.time()
        if cached and now - cached[1] < _VERIFY_TTL_SECONDS:
            return cached[0]

        record = self.resolve(host.ens_name)
        ok = False
        if record:
            ok = (
                record.get("hederaAccountId") == host.hedera_account_id
                and record.get("blockIndices") == host.block_indices
                and record.get("hostId") == host.host_id
            )
        if not ok:
            logger.warning(
                "ens_verify_failed host_id=%s ens_name=%s registry=%s:%s resolved=%s",
                host.host_id,
                host.ens_name,
                host.hedera_account_id,
                host.block_indices,
                record,
            )
        _VERIFY_CACHE[host.host_id] = (ok, now)
        return ok

    def reconcile_registry(self, hosts: List[HostRecord]) -> None:
        if not self.enabled:
            return
        for host in hosts:
            if not host.hedera_account_id or host.layers_hosted <= 0:
                continue
            try:
                if host.ens_name:
                    if not self.verify_host(host):
                        self.update_host(
                            host.ens_name,
                            host_id=host.host_id,
                            hedera_account_id=host.hedera_account_id,
                            block_indices=host.block_indices,
                            layers_hosted=host.layers_hosted,
                            model=host.model,
                            role=host.role,
                            status="online" if host.status == "online" else "offline",
                        )
                else:
                    result = self.provision_host(host)
                    from orchestrator.app.registry import get_registry

                    get_registry().set_ens_name(host.host_id, result.ens_name)
            except EnsClientError as exc:
                logger.exception("ENS reconcile failed for %s: %s", host.host_id, exc)
                _enqueue_pending(
                    {
                        "action": "provision" if not host.ens_name else "update",
                        "hostId": host.host_id,
                        "ensName": host.ens_name,
                    }
                )

    def replay_pending(self, hosts: List[HostRecord]) -> None:
        if not self.enabled:
            return
        by_id = {h.host_id: h for h in hosts}
        for op in _load_pending():
            host = by_id.get(str(op.get("hostId", "")))
            if not host:
                continue
            try:
                if op.get("action") == "provision" or not host.ens_name:
                    result = self.provision_host(host)
                    from orchestrator.app.registry import get_registry

                    get_registry().set_ens_name(host.host_id, result.ens_name)
                elif host.ens_name:
                    self.update_host(
                        host.ens_name,
                        host_id=host.host_id,
                        hedera_account_id=host.hedera_account_id,
                        block_indices=host.block_indices,
                        layers_hosted=host.layers_hosted,
                        model=host.model,
                        role=host.role,
                        status="online" if host.status == "online" else "offline",
                    )
            except EnsClientError:
                logger.exception("ENS pending replay failed for %s", host.host_id)


_ens_client: Optional[EnsServiceClient] = None


def get_ens_client(settings: Optional[Settings] = None) -> EnsServiceClient:
    global _ens_client
    if _ens_client is None:
        _ens_client = EnsServiceClient(settings or get_settings())
    return _ens_client


def sync_host_ens_after_ready(host: HostRecord, donor: Optional[HostRecord]) -> str:
    """Provision contributor + update donor ENS records after mark_ready."""
    client = get_ens_client()
    if not client.enabled:
        return host.ens_name or ""

    result = client.provision_host(host)
    from orchestrator.app.registry import get_registry

    get_registry().set_ens_name(host.host_id, result.ens_name)
    if donor and donor.ens_name:
        client.update_host(
            donor.ens_name,
            host_id=donor.host_id,
            hedera_account_id=donor.hedera_account_id,
            block_indices=donor.block_indices,
            layers_hosted=donor.layers_hosted,
            model=donor.model,
            role=donor.role,
            status="online",
        )
    return result.ens_name


def sync_mother_ens(mother: HostRecord) -> str:
    client = get_ens_client()
    if not client.enabled:
        return mother.ens_name or ""
    result = client.provision_host(mother)
    from orchestrator.app.registry import get_registry

    get_registry().set_ens_name(mother.host_id, result.ens_name)
    return result.ens_name


def sync_leave_ens(leaver: HostRecord, reclaim_host: Optional[HostRecord]) -> None:
    client = get_ens_client()
    if not client.enabled:
        return
    if leaver.ens_name:
        client.deactivate_host(leaver.ens_name)
    if reclaim_host and reclaim_host.ens_name:
        client.update_host(
            reclaim_host.ens_name,
            host_id=reclaim_host.host_id,
            hedera_account_id=reclaim_host.hedera_account_id,
            block_indices=reclaim_host.block_indices,
            layers_hosted=reclaim_host.layers_hosted,
            model=reclaim_host.model,
            role=reclaim_host.role,
            status="online",
        )

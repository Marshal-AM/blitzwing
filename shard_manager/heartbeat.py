"""Background heartbeat to mother orchestrator (contributor liveness)."""

from __future__ import annotations

import logging
import os
import re
import threading
import time
from pathlib import Path
from typing import Callable, Optional

import httpx

logger = logging.getLogger(__name__)

_thread: Optional[threading.Thread] = None


def _local_peer_from_log(log_path: str, port: int) -> Optional[str]:
    try:
        text = Path(log_path).read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return None
    matches = re.findall(
        r"Running a server on \['[^']+/p2p/([A-Za-z0-9]+)'\]",
        text,
    )
    if not matches:
        return None
    return f"/ip4/127.0.0.1/tcp/{port}/p2p/{matches[-1]}"


def start_contributor_heartbeat(
    *,
    host_id: str,
    mother_url: str,
    interval_seconds: float = 20.0,
    status_provider: Optional[Callable[[], dict]] = None,
) -> None:
    """POST /v1/hosts/heartbeat every interval with live layer report."""
    global _thread
    if _thread and _thread.is_alive():
        return
    if not host_id or not mother_url:
        return

    url = f"{mother_url.rstrip('/')}/v1/hosts/heartbeat"

    def _loop() -> None:
        logger.info(
            "Contributor heartbeat started host_id=%s mother=%s every %ss",
            host_id,
            mother_url,
            interval_seconds,
        )
        while True:
            payload = {"host_id": host_id}
            if status_provider:
                try:
                    st = status_provider()
                    if st.get("block_indices"):
                        payload["block_indices"] = st["block_indices"]
                    payload["petals_running"] = bool(st.get("running"))
                    if st.get("shard_manager_url"):
                        payload["shard_manager_url"] = st["shard_manager_url"]
                    if st.get("peer_multiaddr"):
                        payload["peer_multiaddr"] = st["peer_multiaddr"]
                except Exception as exc:  # noqa: BLE001
                    logger.warning("Heartbeat status_provider failed: %s", exc)
            try:
                with httpx.Client(timeout=15.0) as client:
                    resp = client.post(url, json=payload)
                    resp.raise_for_status()
            except Exception as exc:  # noqa: BLE001
                logger.warning("Contributor heartbeat failed: %s", exc)
            time.sleep(interval_seconds)

    _thread = threading.Thread(target=_loop, name="contributor-heartbeat", daemon=True)
    _thread.start()


def maybe_start_from_env(manager=None) -> None:
    host_id = (os.getenv("BLITZWING_HOST_ID") or "").strip()
    mother_url = (os.getenv("BLITZWING_MOTHER_URL") or os.getenv("MOTHER_URL") or "").strip()
    interval = float(os.getenv("HEARTBEAT_INTERVAL_SECONDS", "20"))
    if not host_id or not mother_url:
        return

    def _status() -> dict:
        out: dict = {}
        if manager is not None:
            st = manager.status()
            out["block_indices"] = st.block_indices
            out["running"] = st.running
            out["shard_manager_url"] = os.getenv("BLITZWING_SHARD_MANAGER_URL", "").strip()
            log_path = os.getenv(
                "CONTRIB_SHARD_LOG",
                str(Path.home() / ".blitzwing" / "contrib_shard.out"),
            )
            peer = _local_peer_from_log(log_path, st.port)
            if peer:
                out["peer_multiaddr"] = peer
        return out

    start_contributor_heartbeat(
        host_id=host_id,
        mother_url=mother_url,
        interval_seconds=interval,
        status_provider=_status,
    )

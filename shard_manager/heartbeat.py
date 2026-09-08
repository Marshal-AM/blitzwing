"""Background heartbeat to mother orchestrator (contributor liveness)."""

from __future__ import annotations

import logging
import os
import threading
import time
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

_thread: Optional[threading.Thread] = None


def start_contributor_heartbeat(
    *,
    host_id: str,
    mother_url: str,
    interval_seconds: float = 20.0,
) -> None:
    """POST /v1/hosts/heartbeat every interval until process exit."""
    global _thread
    if _thread and _thread.is_alive():
        return
    if not host_id or not mother_url:
        return

    url = f"{mother_url.rstrip('/')}/v1/hosts/heartbeat"
    payload = {"host_id": host_id}

    def _loop() -> None:
        logger.info(
            "Contributor heartbeat started host_id=%s mother=%s every %ss",
            host_id,
            mother_url,
            interval_seconds,
        )
        while True:
            try:
                with httpx.Client(timeout=15.0) as client:
                    resp = client.post(url, json=payload)
                    resp.raise_for_status()
            except Exception as exc:  # noqa: BLE001
                logger.warning("Contributor heartbeat failed: %s", exc)
            time.sleep(interval_seconds)

    _thread = threading.Thread(target=_loop, name="contributor-heartbeat", daemon=True)
    _thread.start()


def maybe_start_from_env() -> None:
    host_id = (os.getenv("BLITZWING_HOST_ID") or "").strip()
    mother_url = (os.getenv("BLITZWING_MOTHER_URL") or os.getenv("MOTHER_URL") or "").strip()
    interval = float(os.getenv("HEARTBEAT_INTERVAL_SECONDS", "20"))
    if host_id and mother_url:
        start_contributor_heartbeat(
            host_id=host_id,
            mother_url=mother_url,
            interval_seconds=interval,
        )

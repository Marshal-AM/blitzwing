"""Forward inference to contributors over HTTP (avoids mother→NAT libp2p)."""

from __future__ import annotations

import logging
from typing import List, Optional, Sequence

import httpx

from orchestrator.app.engine import GenerationResult
from orchestrator.app.registry import HostRecord, get_registry

logger = logging.getLogger(__name__)


def _is_public_http_url(url: str) -> bool:
    if not url:
        return False
    lower = url.lower()
    if lower.startswith("http://127.") or lower.startswith("http://localhost"):
        return False
    if "/172." in lower or "/192.168." in lower:
        return False
    if url.startswith("http://172.") or url.startswith("http://192.168."):
        return False
    return url.startswith("http://") or url.startswith("https://")


def pick_http_contributor() -> Optional[HostRecord]:
    """Return an online contributor with a publicly reachable shard_manager URL."""
    registry = get_registry()
    for host in registry.list_hosts():
        if host.role != "contributor" or host.status != "online":
            continue
        if _is_public_http_url(host.shard_manager_url):
            return host
    return None


def generate_via_contributor_http(
    contributor: HostRecord,
    messages: Sequence[dict],
    *,
    max_tokens: Optional[int] = None,
    temperature: Optional[float] = 0.7,
    top_p: Optional[float] = 0.9,
    timeout_seconds: float = 180.0,
) -> GenerationResult:
    """POST chat completion to contributor shard manager; contributor reaches mother via libp2p."""
    url = f"{contributor.shard_manager_url.rstrip('/')}/v1/chat/completions"
    payload = {
        "messages": list(messages),
        "max_tokens": max_tokens or 64,
        "temperature": temperature if temperature is not None else 0.7,
        "top_p": top_p if top_p is not None else 0.9,
    }
    logger.info("HTTP inference via contributor %s -> %s", contributor.host_id, url)
    with httpx.Client(timeout=timeout_seconds) as client:
        resp = client.post(url, json=payload)
        resp.raise_for_status()
        data = resp.json()
    return GenerationResult(
        text=data["text"],
        prompt_tokens=int(data["prompt_tokens"]),
        completion_tokens=int(data["completion_tokens"]),
        finish_reason=str(data.get("finish_reason", "stop")),
    )

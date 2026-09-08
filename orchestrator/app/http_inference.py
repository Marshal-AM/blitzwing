"""Forward inference to contributors over HTTP (avoids mother→NAT libp2p)."""

from __future__ import annotations

import logging
from typing import List, Optional, Sequence

import httpx

from orchestrator.app.engine import GenerationResult
from orchestrator.app.swarm_map import LayerSpan, SwarmManifest, pick_http_inference_host

logger = logging.getLogger(__name__)


def generate_via_contributor_http(
    contributor: LayerSpan,
    manifest: SwarmManifest,
    messages: Sequence[dict],
    *,
    max_tokens: Optional[int] = None,
    temperature: Optional[float] = 0.7,
    top_p: Optional[float] = 0.9,
    timeout_seconds: float = 180.0,
) -> GenerationResult:
    """POST chat completion to contributor with mother's authoritative swarm manifest."""
    url = f"{contributor.shard_manager_url.rstrip('/')}/v1/chat/completions"
    payload = {
        "messages": list(messages),
        "max_tokens": max_tokens or 64,
        "temperature": temperature if temperature is not None else 0.7,
        "top_p": top_p if top_p is not None else 0.9,
        "swarm_manifest": manifest.to_dict(),
    }
    logger.info(
        "HTTP inference via contributor %s blocks=%s -> %s",
        contributor.host_id,
        contributor.block_indices,
        url,
    )
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

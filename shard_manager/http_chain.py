"""HTTP-chained distributed inference — no libp2p between nodes."""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from typing import List, Optional, Sequence

import httpx
import torch

from shard_manager.inference import InferenceResult
from shard_manager.local_runner import LocalShardRunner, parse_range
from shard_manager.tensor_codec import tensor_from_payload, tensor_to_payload

logger = logging.getLogger(__name__)


def _is_public_http_url(url: str) -> bool:
    if not url:
        return False
    lower = url.lower()
    if lower.startswith("http://127.") or lower.startswith("http://localhost"):
        return False
    if url.startswith("http://172.") or url.startswith("http://192.168."):
        return False
    return url.startswith("http://") or url.startswith("https://")


def resolve_mother_shard_url(manifest: dict) -> str:
    """Find a reachable HTTP URL for the mother's shard manager."""
    override = (os.getenv("MOTHER_PUBLIC_SHARD_URL") or "").strip().rstrip("/")
    if override:
        return override
    for host in manifest.get("hosts", []):
        if host.get("role") != "mother":
            continue
        url = (host.get("shard_manager_url") or "").rstrip("/")
        if _is_public_http_url(url):
            return url
        public_ip = host.get("public_ip")
        if public_ip:
            return f"http://{public_ip}:8001"
    gateway = (os.getenv("MOTHER_URL") or os.getenv("BLITZWING_MOTHER_URL") or "").strip()
    if gateway:
        # Contributor reaches mother via the public gateway (:8000), not shard :8001.
        return gateway.rstrip("/")
    raise RuntimeError("Cannot resolve mother shard_manager_url from swarm manifest")


def mother_prefix_blocks(manifest: dict) -> str:
    for host in manifest.get("hosts", []):
        if host.get("role") == "mother" and host.get("block_indices"):
            return str(host["block_indices"])
    return "0:18"


@dataclass
class HttpChainInference:
    runner: LocalShardRunner
    local_block_indices: str

    def generate(
        self,
        messages: Sequence[dict],
        *,
        max_tokens: int = 64,
        temperature: float = 0.7,
        top_p: float = 0.9,
        swarm_manifest: Optional[dict] = None,
    ) -> InferenceResult:
        if not swarm_manifest:
            raise RuntimeError("swarm_manifest required for HTTP-chained inference")

        mother_url = resolve_mother_shard_url(swarm_manifest)
        mother_blocks = mother_prefix_blocks(swarm_manifest)
        _, mother_end = parse_range(mother_blocks)
        local_start, local_end = parse_range(self.local_block_indices)

        if local_start != mother_end:
            logger.warning(
                "Layer gap between mother end=%s and local start=%s",
                mother_end,
                local_start,
            )

        tokenizer = self.runner.tokenizer
        try:
            prompt = tokenizer.apply_chat_template(
                list(messages),
                tokenize=False,
                add_generation_prompt=True,
            )
        except Exception:  # noqa: BLE001
            parts: List[str] = []
            for msg in messages:
                role = msg.get("role", "user")
                content = msg.get("content", "")
                parts.append(f"<|{role}|>\n{content}</s>")
            parts.append("<|assistant|>\n")
            prompt = "".join(parts)

        input_ids = tokenizer(prompt, return_tensors="pt")["input_ids"]
        prompt_tokens = int(input_ids.shape[-1])
        max_new_tokens = max(1, min(int(max_tokens), 512))
        generated: List[int] = []
        finish_reason = "stop"

        with httpx.Client(timeout=300.0) as client:
            for _ in range(max_new_tokens):
                full_ids = torch.cat(
                    [input_ids, torch.tensor([generated], dtype=input_ids.dtype)],
                    dim=-1,
                ) if generated else input_ids

                prefix_resp = client.post(
                    f"{mother_url.rstrip('/')}/v1/chain/prefix",
                    json={"input_ids": full_ids[0].tolist()},
                )
                prefix_resp.raise_for_status()
                hidden = tensor_from_payload(prefix_resp.json()["hidden"])

                hidden = self.runner.forward_tail(hidden)
                logits = self.runner.logits_from_hidden(hidden)
                next_logits = logits[0, -1, :]

                if temperature <= 0:
                    next_id = int(torch.argmax(next_logits).item())
                else:
                    probs = torch.softmax(next_logits / float(temperature), dim=-1)
                    if top_p < 1.0:
                        sorted_probs, sorted_idx = torch.sort(probs, descending=True)
                        cumulative = torch.cumsum(sorted_probs, dim=-1)
                        mask = cumulative > float(top_p)
                        mask[..., 1:] = mask[..., :-1].clone()
                        mask[..., 0] = False
                        sorted_probs[mask] = 0
                        sorted_probs = sorted_probs / sorted_probs.sum()
                        pick = torch.multinomial(sorted_probs, 1).item()
                        next_id = int(sorted_idx[pick].item())
                    else:
                        next_id = int(torch.multinomial(probs, 1).item())

                generated.append(next_id)
                if next_id == tokenizer.eos_token_id:
                    break
            else:
                finish_reason = "length"

        text = tokenizer.decode(generated, skip_special_tokens=True)
        return InferenceResult(
            text=text,
            prompt_tokens=prompt_tokens,
            completion_tokens=len(generated),
            finish_reason=finish_reason,
        )

"""HTTP-chained distributed inference — every online host runs its layer slice."""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from typing import List, Optional, Sequence, Tuple

import httpx
import torch

from inference import InferenceResult
from local_runner import LocalShardRunner, parse_range
from tensor_codec import tensor_from_payload, tensor_to_payload

logger = logging.getLogger(__name__)


def _is_public_http_url(url: str) -> bool:
    if not url:
        return False
    lower = url.lower()
    if lower.startswith("http://127.") or lower.startswith("http://localhost"):
        return False
    if url.startswith("http://172.") or url.startswith("http://192.168."):
        return False
    if url.startswith("http://10."):
        return False
    return url.startswith("http://") or url.startswith("https://")


def _is_reachable_mother_url(url: str) -> bool:
    if not _is_public_http_url(url):
        return False
    if url.rstrip("/").endswith(":8001"):
        return False
    return True


def resolve_mother_shard_url(manifest: dict) -> str:
    for env_key in ("MOTHER_PUBLIC_SHARD_URL",):
        override = (os.getenv(env_key) or "").strip().rstrip("/")
        if override:
            return override

    gateway = (
        os.getenv("MOTHER_URL")
        or os.getenv("BLITZWING_MOTHER_URL")
        or os.getenv("MOTHER_PUBLIC_GATEWAY_URL")
        or ""
    ).strip().rstrip("/")
    if gateway:
        return gateway

    for host in manifest.get("hosts", []):
        if host.get("role") != "mother":
            continue
        url = (host.get("shard_manager_url") or "").rstrip("/")
        if _is_reachable_mother_url(url):
            return url
        public_ip = host.get("public_ip")
        if public_ip:
            return f"http://{public_ip}:8000"
    raise RuntimeError(
        "Cannot resolve mother prefix URL from swarm manifest "
        "(set BLITZWING_MOTHER_URL or MOTHER_PUBLIC_SHARD_URL)"
    )


def ordered_hosts(manifest: dict) -> List[dict]:
    hosts = [h for h in manifest.get("hosts", []) if h.get("block_indices")]
    hosts.sort(key=lambda h: parse_range(str(h["block_indices"]))[0])
    return hosts


def validate_chain_coverage(hosts: List[dict], total_layers: int) -> None:
    if not hosts:
        raise RuntimeError("swarm_manifest has no hosts")
    expected = 0
    for host in hosts:
        start, end = parse_range(str(host["block_indices"]))
        if start != expected:
            raise RuntimeError(
                f"layer gap before {host.get('host_id')}: expected start={expected}, got {start}"
            )
        expected = end
    if total_layers and expected != int(total_layers):
        raise RuntimeError(
            f"layer map incomplete: covered 0:{expected}, need 0:{total_layers}"
        )


def host_http_url(host: dict, manifest: dict) -> str:
    if host.get("role") == "mother":
        return resolve_mother_shard_url(manifest)
    url = (host.get("shard_manager_url") or "").rstrip("/")
    if not _is_public_http_url(url):
        raise RuntimeError(
            f"host {host.get('host_id')} has no public shard_manager_url "
            f"(got {url or 'empty'}) — cannot include it in HTTP chain"
        )
    return url


@dataclass
class HttpChainInference:
    runner: LocalShardRunner
    local_block_indices: str

    def _remote_prefix(self, client: httpx.Client, url: str, input_ids: List[int]) -> torch.Tensor:
        resp = client.post(
            f"{url.rstrip('/')}/v1/chain/prefix",
            json={"input_ids": input_ids},
        )
        resp.raise_for_status()
        return tensor_from_payload(resp.json()["hidden"])

    def _remote_continue(self, client: httpx.Client, url: str, hidden: torch.Tensor) -> torch.Tensor:
        resp = client.post(
            f"{url.rstrip('/')}/v1/chain/continue",
            json={"hidden": tensor_to_payload(hidden)},
        )
        resp.raise_for_status()
        return tensor_from_payload(resp.json()["hidden"])

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

        hosts = ordered_hosts(swarm_manifest)
        total_layers = int(swarm_manifest.get("total_layers") or 0)
        validate_chain_coverage(hosts, total_layers)

        local_start, local_end = parse_range(self.local_block_indices)
        tail = hosts[-1]
        tail_start, tail_end = parse_range(str(tail["block_indices"]))
        if (tail_start, tail_end) != (local_start, local_end):
            raise RuntimeError(
                f"local blocks {self.local_block_indices} are not the tail "
                f"(tail is {tail.get('host_id')} {tail['block_indices']})"
            )

        upstream = hosts[:-1]
        hop_timeout = float(os.getenv("HTTP_CHAIN_PREFIX_TIMEOUT", "120"))

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
        hop_desc = " -> ".join(
            f"{h.get('host_id')}[{h.get('block_indices')}]" for h in hosts
        )
        logger.info(
            "HTTP chain hops=%s local=%s max_tokens=%s",
            hop_desc,
            self.local_block_indices,
            max_new_tokens,
        )
        generated: List[int] = []
        finish_reason = "stop"

        with httpx.Client(timeout=hop_timeout) as client:
            for step in range(max_new_tokens):
                full_ids = (
                    torch.cat(
                        [input_ids, torch.tensor([generated], dtype=input_ids.dtype)],
                        dim=-1,
                    )
                    if generated
                    else input_ids
                )
                token_ids = full_ids[0].tolist()

                if not upstream:
                    # Mother-only / single-node: run everything locally.
                    hidden = self.runner.forward_prefix(
                        torch.tensor([token_ids], dtype=torch.long)
                    )
                else:
                    first = upstream[0]
                    first_url = host_http_url(first, swarm_manifest)
                    hidden = self._remote_prefix(client, first_url, token_ids)
                    logger.debug(
                        "HTTP chain step %s: prefix via %s ok",
                        step,
                        first.get("host_id"),
                    )
                    for mid in upstream[1:]:
                        mid_url = host_http_url(mid, swarm_manifest)
                        hidden = self._remote_continue(client, mid_url, hidden)
                        logger.debug(
                            "HTTP chain step %s: continue via %s ok",
                            step,
                            mid.get("host_id"),
                        )
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

"""Run distributed inference on a contributor (mother blocks via libp2p + local tail)."""

from __future__ import annotations

import logging
import os
import re
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional, Sequence

import torch

logger = logging.getLogger(__name__)


@dataclass
class InferenceResult:
    text: str
    prompt_tokens: int
    completion_tokens: int
    finish_reason: str


class ContributorInference:
    """Lazy Petals client — mother via libp2p + local server for tail blocks."""

    def __init__(
        self,
        model_name: str,
        initial_peers: List[str],
        *,
        local_port: int = 31338,
        log_path: Optional[str] = None,
        local_block_indices: Optional[str] = None,
    ) -> None:
        self.model_name = model_name
        self.local_port = local_port
        self.log_path = log_path
        self.local_block_indices = local_block_indices
        self.initial_peers = self._build_peers(initial_peers, local_port, log_path)
        self._tokenizer = None
        self._model = None
        self._lock = threading.Lock()
        self._ready = threading.Event()

    @staticmethod
    def _local_peer_from_log(log_path: str, port: int) -> Optional[str]:
        try:
            text = Path(log_path).read_text(encoding="utf-8", errors="ignore")
        except OSError:
            return None
        # Prefer the last "Running a server on" line (most recent start).
        matches = re.findall(
            r"Running a server on \['[^']+/p2p/([A-Za-z0-9]+)'\]",
            text,
        )
        if not matches:
            return None
        return f"/ip4/127.0.0.1/tcp/{port}/p2p/{matches[-1]}"

    def _resolve_local_peer(self, *, timeout_seconds: float = 60.0) -> Optional[str]:
        """Wait until the local Petals server has printed its peer id."""
        log = self.log_path or os.getenv(
            "CONTRIB_SHARD_LOG",
            str(Path.home() / ".blitzwing" / "contrib_shard.out"),
        )
        deadline = time.time() + timeout_seconds
        while time.time() < deadline:
            peer = self._local_peer_from_log(log, self.local_port)
            if peer:
                return peer
            time.sleep(1.0)
        return None

    def _build_peers(
        self,
        initial_peers: List[str],
        local_port: int,
        log_path: Optional[str],
        *,
        wait_local: bool = False,
    ) -> List[str]:
        peers = [p for p in initial_peers if p and "/127.0.0.1/" not in p]
        log = log_path or os.getenv(
            "CONTRIB_SHARD_LOG",
            str(Path.home() / ".blitzwing" / "contrib_shard.out"),
        )
        if wait_local:
            local_peer = self._resolve_local_peer()
        else:
            local_peer = self._local_peer_from_log(log, local_port)
        if local_peer and local_peer not in peers:
            peers = [local_peer] + peers
            logger.info("Added local Petals peer for tail blocks: %s", local_peer)
        elif not local_peer:
            logger.warning("Local Petals peer not found in %s yet", log)
        return peers

    def _sequence_manager(self):
        model = self._model
        # Llama: model.model.layers; Bloom/Falcon: model.transformer.h
        for path in ("model.layers", "transformer.h", "layers"):
            obj = model
            ok = True
            for part in path.split("."):
                if not hasattr(obj, part):
                    ok = False
                    break
                obj = getattr(obj, part)
            if ok and hasattr(obj, "sequence_manager"):
                return obj.sequence_manager
        raise RuntimeError("Could not locate Petals sequence_manager on model")

    def _missing_blocks(self) -> List[int]:
        sm = self._sequence_manager()
        missing: List[int] = []
        spans = sm.state.sequence_info.spans_containing_block
        for idx in range(len(sm)):
            if not spans[idx]:
                missing.append(idx)
        return missing

    def _refresh_dht(self) -> None:
        """Synchronous DHT refresh (must not hang forever)."""
        sm = self._sequence_manager()
        # Prefer direct _update — update(wait=True) can block indefinitely.
        sm._update()

    def _wait_until_routable(self, *, timeout_seconds: float = 90.0) -> None:
        """Poll DHT until every block has at least one server (fast path for queries)."""
        deadline = time.time() + timeout_seconds
        attempt = 0
        while time.time() < deadline:
            attempt += 1
            try:
                self._refresh_dht()
            except Exception as exc:  # noqa: BLE001
                logger.warning("DHT update failed (attempt %s): %s", attempt, exc)
            missing = self._missing_blocks()
            if not missing:
                logger.info("All blocks visible in DHT after %s updates", attempt)
                self._ready.set()
                return
            logger.info(
                "Waiting for DHT blocks still missing=%s (attempt %s)",
                missing[:8] + (["…"] if len(missing) > 8 else []),
                attempt,
            )
            time.sleep(min(2.0, 0.4 * attempt))
        raise TimeoutError(
            f"DHT still missing blocks after {timeout_seconds}s: {self._missing_blocks()}"
        )

    def _peers_from_manifest(self, manifest: dict) -> List[str]:
        """Build initial_peers from mother's authoritative swarm manifest."""
        peers: List[str] = []
        local_blocks = self.local_block_indices
        for host in manifest.get("hosts", []):
            maddr = host.get("peer_multiaddr")
            blocks = host.get("block_indices")
            if not maddr:
                continue
            # Skip our own range — local peer is added separately.
            if local_blocks and blocks == local_blocks:
                continue
            if maddr not in peers:
                peers.append(maddr)
        return peers

    def _apply_swarm_manifest(self, manifest: Optional[dict]) -> None:
        if not manifest:
            return
        manifest_peers = self._peers_from_manifest(manifest)
        if not manifest_peers:
            return
        merged = list(manifest_peers)
        local_peer = next((p for p in self.initial_peers if "/127.0.0.1/" in p), None)
        if local_peer and local_peer not in merged:
            merged = [local_peer] + merged
        if merged != self.initial_peers:
            logger.info("Applying swarm manifest peers: %s", merged)
            self.initial_peers = merged
            with self._lock:
                if self._model is not None:
                    self._model = None
                    self._tokenizer = None
                    self._ready.clear()

    def _ensure_loaded(self, swarm_manifest: Optional[dict] = None) -> None:
        self._apply_swarm_manifest(swarm_manifest)
        with self._lock:
            if self._model is not None:
                if not self._ready.is_set():
                    self._wait_until_routable()
                return
            # Wait for local server peer id before connecting — otherwise DHT never
            # sees our own tail blocks and queries stall for minutes.
            self.initial_peers = self._build_peers(
                self.initial_peers,
                self.local_port,
                self.log_path,
                wait_local=True,
            )
            if not self.initial_peers:
                raise RuntimeError("INITIAL_PEERS empty — cannot reach mother swarm")
            if not any("/127.0.0.1/" in p for p in self.initial_peers):
                raise RuntimeError(
                    "Local Petals peer missing — cannot route tail blocks without it"
                )
            from transformers import AutoTokenizer

            from petals import AutoDistributedModelForCausalLM

            logger.info("Loading contributor Petals client peers=%s", self.initial_peers)
            self._tokenizer = AutoTokenizer.from_pretrained(self.model_name, use_fast=True)
            if self._tokenizer.pad_token is None:
                self._tokenizer.pad_token = self._tokenizer.eos_token
            self._model = AutoDistributedModelForCausalLM.from_pretrained(
                self.model_name,
                initial_peers=self.initial_peers,
                torch_dtype=torch.float32,
                update_period=5,
                max_retries=8,
                min_backoff=0.25,
                max_backoff=4,
                request_timeout=60,
            )
            logger.info("Contributor Petals client loaded — waiting for full DHT route")
            self._wait_until_routable()

    def warm_up(self) -> None:
        """Preload client + wait for DHT so the first HTTP query is fast."""
        self._ensure_loaded()

    def generate(
        self,
        messages: Sequence[dict],
        *,
        max_tokens: int = 64,
        temperature: float = 0.7,
        top_p: float = 0.9,
        swarm_manifest: Optional[dict] = None,
    ) -> InferenceResult:
        self._ensure_loaded(swarm_manifest=swarm_manifest)
        assert self._tokenizer is not None and self._model is not None

        # One quick DHT refresh if anything went missing since warm-up.
        missing = self._missing_blocks()
        if missing:
            logger.warning("Blocks missing before generate (%s) — refreshing DHT", missing)
            self._wait_until_routable(timeout_seconds=30.0)

        try:
            prompt = self._tokenizer.apply_chat_template(
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

        inputs = self._tokenizer(prompt, return_tensors="pt")
        input_ids = inputs["input_ids"]
        prompt_tokens = int(input_ids.shape[-1])
        max_new_tokens = max(1, min(int(max_tokens), 512))

        kwargs: dict = {
            "max_new_tokens": max_new_tokens,
            "pad_token_id": self._tokenizer.eos_token_id,
            "eos_token_id": self._tokenizer.eos_token_id,
        }
        if temperature <= 0:
            kwargs["do_sample"] = False
        else:
            kwargs["do_sample"] = True
            kwargs["temperature"] = float(temperature)
            kwargs["top_p"] = float(top_p)

        with torch.inference_mode():
            output_ids = self._model.generate(input_ids, **kwargs)

        completion_ids = output_ids[0][prompt_tokens:]
        text = self._tokenizer.decode(completion_ids, skip_special_tokens=True)
        completion_tokens = int(completion_ids.shape[-1])
        finish_reason = "length" if completion_tokens >= max_new_tokens else "stop"
        return InferenceResult(
            text=text,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            finish_reason=finish_reason,
        )


_client: Optional[ContributorInference] = None
_client_lock = threading.Lock()


def get_contributor_inference(
    model_name: str,
    initial_peers: List[str],
    *,
    local_port: int = 31338,
    log_path: Optional[str] = None,
    local_block_indices: Optional[str] = None,
) -> ContributorInference:
    global _client
    with _client_lock:
        if _client is None:
            _client = ContributorInference(
                model_name,
                initial_peers,
                local_port=local_port,
                log_path=log_path,
                local_block_indices=local_block_indices,
            )
        return _client


def warm_contributor_inference_async(
    model_name: str,
    initial_peers: List[str],
    *,
    local_port: int = 31338,
    log_path: Optional[str] = None,
    delay_seconds: float = 8.0,
) -> None:
    """Background warm-up so DHT is ready before the first paid query arrives."""

    def _run() -> None:
        if delay_seconds > 0:
            time.sleep(delay_seconds)
        try:
            client = get_contributor_inference(
                model_name,
                initial_peers,
                local_port=local_port,
                log_path=log_path,
            )
            client.warm_up()
            logger.info("Contributor inference warm-up complete")
        except Exception:  # noqa: BLE001
            logger.exception("Contributor inference warm-up failed")

    threading.Thread(target=_run, name="contrib-warmup", daemon=True).start()

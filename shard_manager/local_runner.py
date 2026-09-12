"""Petals client that only talks to the local server (no remote DHT)."""

from __future__ import annotations

import logging
import os
import re
import threading
import time
from pathlib import Path
from typing import List, Optional, Tuple

import torch

logger = logging.getLogger(__name__)


def parse_range(block_indices: str) -> Tuple[int, int]:
    start_s, end_s = block_indices.split(":")
    return int(start_s), int(end_s)


def _peer_from_log(log_path: str, port: int) -> Optional[str]:
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


class LocalShardRunner:
    """Forward pass through this node's Petals server blocks only."""

    def __init__(
        self,
        model_name: str,
        block_indices: str,
        *,
        local_port: int,
        log_path: Optional[str] = None,
    ) -> None:
        self.model_name = model_name
        self.block_start, self.block_end = parse_range(block_indices)
        self.local_port = local_port
        if log_path:
            self.log_path = log_path
        else:
            explicit = os.getenv("PETALS_SERVER_LOG") or os.getenv("CONTRIB_SHARD_LOG")
            if explicit:
                self.log_path = explicit
            else:
                mother_log = Path.home() / "blitzwing-logs" / "shard_manager.log"
                self.log_path = (
                    str(mother_log)
                    if mother_log.exists()
                    else str(Path.home() / ".blitzwing" / "contrib_shard.out")
                )
        self._model = None
        self._tokenizer = None
        self._lock = threading.Lock()

    def _resolve_local_peer(self, *, timeout_seconds: float = 90.0) -> str:
        deadline = time.time() + timeout_seconds
        while time.time() < deadline:
            peer = _peer_from_log(self.log_path, self.local_port)
            if peer:
                return peer
            time.sleep(1.0)
        raise RuntimeError(f"Local Petals peer not found in {self.log_path}")

    def _ensure_loaded(self) -> None:
        with self._lock:
            if self._model is not None:
                return
            local_peer = self._resolve_local_peer()
            from transformers import AutoTokenizer

            from petals import AutoDistributedModelForCausalLM

            logger.info(
                "Loading local-only Petals client blocks=%s:%s peer=%s",
                self.block_start,
                self.block_end,
                local_peer,
            )
            self._tokenizer = AutoTokenizer.from_pretrained(self.model_name, use_fast=True)
            if self._tokenizer.pad_token is None:
                self._tokenizer.pad_token = self._tokenizer.eos_token
            self._model = AutoDistributedModelForCausalLM.from_pretrained(
                self.model_name,
                initial_peers=[local_peer],
                torch_dtype=torch.float32,
                update_period=30,
            )
            logger.info("Local-only Petals client ready")

    @property
    def model(self):
        self._ensure_loaded()
        assert self._model is not None
        return self._model

    @property
    def tokenizer(self):
        self._ensure_loaded()
        assert self._tokenizer is not None
        return self._tokenizer

    def _layers(self):
        m = self.model
        if hasattr(m, "model") and hasattr(m.model, "layers"):
            return m.model.layers
        if hasattr(m, "transformer") and hasattr(m.transformer, "h"):
            return m.transformer.h
        raise RuntimeError("Could not locate transformer layers")

    def _embed(self, input_ids: torch.Tensor) -> torch.Tensor:
        m = self.model
        if hasattr(m, "model") and hasattr(m.model, "embed_tokens"):
            return m.model.embed_tokens(input_ids)
        if hasattr(m, "transformer") and hasattr(m.transformer, "word_embeddings"):
            return m.transformer.word_embeddings(input_ids)
        raise RuntimeError("Could not locate embedding layer")

    def _total_layers(self) -> int:
        env_total = os.getenv("TOTAL_LAYERS", "").strip()
        if env_total.isdigit():
            return int(env_total)
        m = self.model
        config = getattr(m, "config", None)
        if config is not None:
            for key in ("num_hidden_layers", "n_layer", "num_layers"):
                value = getattr(config, key, None)
                if isinstance(value, int) and value > 0:
                    return value
        return self.block_end

    def _is_tail_host(self) -> bool:
        return self.block_end >= self._total_layers()

    def _final_norm(self, hidden: torch.Tensor) -> torch.Tensor:
        """Apply final RMSNorm before lm_head on the tail host (Llama/SmolLM2)."""
        m = self.model
        if hasattr(m, "model") and hasattr(m.model, "norm"):
            return m.model.norm(hidden)
        if hasattr(m, "transformer") and hasattr(m.transformer, "ln_f"):
            return m.transformer.ln_f(hidden)
        return hidden

    def _lm_head(self, hidden: torch.Tensor) -> torch.Tensor:
        m = self.model
        if hasattr(m, "lm_head"):
            return m.lm_head(hidden)
        if hasattr(m, "model") and hasattr(m.model, "lm_head"):
            return m.model.lm_head(hidden)
        raise RuntimeError("Could not locate lm_head")

    def forward_prefix(self, input_ids: torch.Tensor) -> torch.Tensor:
        """Run embeddings + local prefix blocks; return hidden states."""
        hidden = self._embed(input_ids)
        layers = self._layers()
        for idx in range(self.block_start, self.block_end):
            hidden = layers[idx](hidden)
        return hidden

    def forward_tail(self, hidden: torch.Tensor) -> torch.Tensor:
        """Continue from hidden states through local tail blocks."""
        layers = self._layers()
        for idx in range(self.block_start, self.block_end):
            hidden = layers[idx](hidden)
        return hidden

    def logits_from_hidden(self, hidden: torch.Tensor) -> torch.Tensor:
        if self._is_tail_host():
            hidden = self._final_norm(hidden)
        return self._lm_head(hidden)

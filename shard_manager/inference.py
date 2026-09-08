"""Run distributed inference on a contributor (mother blocks via libp2p + local tail)."""

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass
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
    """Lazy Petals client — connects outbound to mother, uses local server for tail blocks."""

    def __init__(self, model_name: str, initial_peers: List[str]) -> None:
        self.model_name = model_name
        self.initial_peers = [p for p in initial_peers if p]
        self._tokenizer = None
        self._model = None
        self._lock = threading.Lock()

    def _ensure_loaded(self) -> None:
        with self._lock:
            if self._model is not None:
                return
            if not self.initial_peers:
                raise RuntimeError("INITIAL_PEERS empty — cannot reach mother swarm")
            from transformers import AutoTokenizer

            from petals import AutoDistributedModelForCausalLM

            logger.info("Loading contributor Petals client peers=%s", self.initial_peers)
            self._tokenizer = AutoTokenizer.from_pretrained(self.model_name, use_fast=True)
            if self._tokenizer.pad_token is None:
                self._tokenizer.pad_token = self._tokenizer.eos_token
            self._model = AutoDistributedModelForCausalLM.from_pretrained(
                self.model_name,
                initial_peers=self.initial_peers,
                torch_dtype="auto",
            )
            logger.info("Contributor Petals client ready")

    def generate(
        self,
        messages: Sequence[dict],
        *,
        max_tokens: int = 64,
        temperature: float = 0.7,
        top_p: float = 0.9,
    ) -> InferenceResult:
        self._ensure_loaded()
        assert self._tokenizer is not None and self._model is not None

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


def get_contributor_inference(model_name: str, initial_peers: List[str]) -> ContributorInference:
    global _client
    with _client_lock:
        if _client is None:
            _client = ContributorInference(model_name, initial_peers)
        return _client

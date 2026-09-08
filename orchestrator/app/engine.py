"""Petals-backed generation engine for chat completions."""

from __future__ import annotations

import logging
import threading
import time
import uuid
from dataclasses import dataclass
from typing import Generator, Iterable, List, Optional, Sequence

import torch
from transformers import AutoTokenizer, TextIteratorStreamer

from orchestrator.app.errors import MissingBlocksServiceError

logger = logging.getLogger(__name__)


@dataclass
class GenerationResult:
    text: str
    prompt_tokens: int
    completion_tokens: int
    finish_reason: str


class PetalsEngine:
    """Lazy-loaded TinyLlama client connected to a private Petals swarm."""

    def __init__(self, settings: Optional[Settings] = None) -> None:
        self.settings = settings or get_settings()
        self._tokenizer = None
        self._model = None
        self._lock = threading.Lock()
        self._load_error: Optional[str] = None

    @property
    def model_name(self) -> str:
        return self.settings.model_name

    @property
    def is_loaded(self) -> bool:
        return self._model is not None and self._tokenizer is not None

    @property
    def load_error(self) -> Optional[str]:
        return self._load_error

    def load(self) -> None:
        with self._lock:
            if self.is_loaded:
                return
            if not self.settings.initial_peers:
                raise RuntimeError(
                    "INITIAL_PEERS is empty. Set it to the VM1 bootstrap multiaddr "
                    "(e.g. /ip4/<VM1_IP>/tcp/31337/p2p/<PEER_ID>)."
                )
            logger.info(
                "Loading Petals client model=%s peers=%s",
                self.settings.model_name,
                self.settings.initial_peers,
            )
            try:
                self._tokenizer = AutoTokenizer.from_pretrained(
                    self.settings.model_name,
                    use_fast=True,
                )
                if self._tokenizer.pad_token is None:
                    self._tokenizer.pad_token = self._tokenizer.eos_token

                from petals import AutoDistributedModelForCausalLM

                self._model = AutoDistributedModelForCausalLM.from_pretrained(
                    self.settings.model_name,
                    initial_peers=self.settings.initial_peers,
                    torch_dtype="auto",
                )
                self._load_error = None
                logger.info("Petals client ready")
            except Exception as exc:  # noqa: BLE001 — surface any connect/load failure
                self._tokenizer = None
                self._model = None
                self._load_error = str(exc)
                logger.exception("Failed to load Petals client")
                raise

    def _ensure_loaded(self) -> None:
        if not self.is_loaded:
            self.load()

    def _cap_max_tokens(self, max_tokens: Optional[int]) -> int:
        value = max_tokens if max_tokens is not None else self.settings.default_max_tokens
        value = max(1, int(value))
        return min(value, self.settings.hard_max_tokens)

    def _build_prompt(self, messages: Sequence[dict]) -> str:
        self._ensure_loaded()
        assert self._tokenizer is not None
        try:
            return self._tokenizer.apply_chat_template(
                list(messages),
                tokenize=False,
                add_generation_prompt=True,
            )
        except Exception:  # noqa: BLE001 — some tokenizers lack chat templates
            parts: List[str] = []
            for msg in messages:
                role = msg.get("role", "user")
                content = msg.get("content", "")
                parts.append(f"<|{role}|>\n{content}</s>")
            parts.append("<|assistant|>\n")
            return "".join(parts)

    def _generation_kwargs(
        self,
        *,
        temperature: Optional[float],
        top_p: Optional[float],
        max_new_tokens: int,
        stop: Optional[Iterable[str]],
    ) -> dict:
        kwargs: dict = {
            "max_new_tokens": max_new_tokens,
            "do_sample": True,
            "pad_token_id": self._tokenizer.eos_token_id,
            "eos_token_id": self._tokenizer.eos_token_id,
        }
        if temperature is not None:
            if temperature <= 0:
                kwargs["do_sample"] = False
            else:
                kwargs["temperature"] = float(temperature)
        if top_p is not None and kwargs.get("do_sample", True):
            kwargs["top_p"] = float(top_p)
        if stop:
            # Petals/HF stop strings via stopping criteria are awkward; ignore for spine.
            # Kept in signature for OpenAI API compatibility.
            _ = stop
        return kwargs

    def unload(self) -> None:
        with self._lock:
            self._model = None
            self._tokenizer = None
            self._load_error = None

    def reload(self) -> None:
        self.unload()
        self.load()

    def _generate_once(
        self,
        messages: Sequence[dict],
        *,
        max_tokens: Optional[int] = None,
        temperature: Optional[float] = 0.7,
        top_p: Optional[float] = 0.9,
        stop: Optional[Iterable[str]] = None,
    ) -> GenerationResult:
        self._ensure_loaded()
        assert self._tokenizer is not None and self._model is not None

        prompt = self._build_prompt(messages)
        inputs = self._tokenizer(prompt, return_tensors="pt")
        input_ids = inputs["input_ids"]
        prompt_tokens = int(input_ids.shape[-1])
        max_new_tokens = self._cap_max_tokens(max_tokens)
        gen_kwargs = self._generation_kwargs(
            temperature=temperature,
            top_p=top_p,
            max_new_tokens=max_new_tokens,
            stop=stop,
        )

        with torch.inference_mode():
            output_ids = self._model.generate(input_ids, **gen_kwargs)

        completion_ids = output_ids[0][prompt_tokens:]
        text = self._tokenizer.decode(completion_ids, skip_special_tokens=True)
        completion_tokens = int(completion_ids.shape[-1])
        finish_reason = "length" if completion_tokens >= max_new_tokens else "stop"
        return GenerationResult(
            text=text,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            finish_reason=finish_reason,
        )

    def generate(
        self,
        messages: Sequence[dict],
        *,
        max_tokens: Optional[int] = None,
        temperature: Optional[float] = 0.7,
        top_p: Optional[float] = 0.9,
        stop: Optional[Iterable[str]] = None,
    ) -> GenerationResult:
        from petals.client.routing.sequence_manager import MissingBlocksError

        try:
            return self._generate_once(
                messages,
                max_tokens=max_tokens,
                temperature=temperature,
                top_p=top_p,
                stop=stop,
            )
        except MissingBlocksError as exc:
            logger.warning("MissingBlocksError — reloading Petals client and retrying once")
            self.reload()
            try:
                return self._generate_once(
                    messages,
                    max_tokens=max_tokens,
                    temperature=temperature,
                    top_p=top_p,
                    stop=stop,
                )
            except MissingBlocksError as retry_exc:
                raise MissingBlocksServiceError(message=str(retry_exc)) from retry_exc

    def stream_generate(
        self,
        messages: Sequence[dict],
        *,
        max_tokens: Optional[int] = None,
        temperature: Optional[float] = 0.7,
        top_p: Optional[float] = 0.9,
        stop: Optional[Iterable[str]] = None,
    ) -> Generator[str, None, GenerationResult]:
        """Yield text deltas; return final GenerationResult via StopIteration.value (PEP 380)."""
        from petals.client.routing.sequence_manager import MissingBlocksError

        try:
            yield from self._stream_generate_once(
                messages,
                max_tokens=max_tokens,
                temperature=temperature,
                top_p=top_p,
                stop=stop,
            )
        except MissingBlocksError as exc:
            logger.warning("MissingBlocksError — reloading Petals client and retrying stream once")
            self.reload()
            try:
                yield from self._stream_generate_once(
                    messages,
                    max_tokens=max_tokens,
                    temperature=temperature,
                    top_p=top_p,
                    stop=stop,
                )
            except MissingBlocksError as retry_exc:
                raise MissingBlocksServiceError(message=str(retry_exc)) from retry_exc

    def _stream_generate_once(
        self,
        messages: Sequence[dict],
        *,
        max_tokens: Optional[int] = None,
        temperature: Optional[float] = 0.7,
        top_p: Optional[float] = 0.9,
        stop: Optional[Iterable[str]] = None,
    ) -> Generator[str, None, GenerationResult]:
        self._ensure_loaded()
        assert self._tokenizer is not None and self._model is not None

        prompt = self._build_prompt(messages)
        inputs = self._tokenizer(prompt, return_tensors="pt")
        input_ids = inputs["input_ids"]
        prompt_tokens = int(input_ids.shape[-1])
        max_new_tokens = self._cap_max_tokens(max_tokens)
        gen_kwargs = self._generation_kwargs(
            temperature=temperature,
            top_p=top_p,
            max_new_tokens=max_new_tokens,
            stop=stop,
        )

        streamer = TextIteratorStreamer(
            self._tokenizer,
            skip_prompt=True,
            skip_special_tokens=True,
        )
        gen_kwargs["streamer"] = streamer

        errors: List[BaseException] = []

        def _run() -> None:
            try:
                with torch.inference_mode():
                    self._model.generate(input_ids, **gen_kwargs)
            except BaseException as exc:  # noqa: BLE001
                errors.append(exc)

        thread = threading.Thread(target=_run, daemon=True)
        thread.start()

        pieces: List[str] = []
        for piece in streamer:
            pieces.append(piece)
            yield piece

        thread.join()
        if errors:
            raise errors[0]

        text = "".join(pieces)
        # Approximate completion tokens from decoded text when streamer path is used.
        completion_tokens = len(self._tokenizer.encode(text, add_special_tokens=False))
        finish_reason = "length" if completion_tokens >= max_new_tokens else "stop"
        return GenerationResult(
            text=text,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            finish_reason=finish_reason,
        )


_engine: Optional[PetalsEngine] = None


def get_engine() -> PetalsEngine:
    global _engine
    if _engine is None:
        _engine = PetalsEngine()
    return _engine


def new_completion_id() -> str:
    return f"chatcmpl-{uuid.uuid4().hex[:24]}"


def now_ts() -> int:
    return int(time.time())

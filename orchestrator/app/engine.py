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

from orchestrator.app.config import Settings, get_settings
from orchestrator.app.errors import MissingBlocksServiceError, HttpInferenceError

logger = logging.getLogger(__name__)


@dataclass
class GenerationResult:
    text: str
    prompt_tokens: int
    completion_tokens: int
    finish_reason: str


class PetalsEngine:
    """Lazy-loaded SmolLM2 client connected to a private Petals swarm."""

    def __init__(self, settings: Optional[Settings] = None) -> None:
        self.settings = settings or get_settings()
        self._tokenizer = None
        self._model = None
        self._lock = threading.Lock()
        self._load_error: Optional[str] = None
        self._extra_peers: List[str] = []

    @property
    def model_name(self) -> str:
        return self.settings.model_name

    @property
    def is_loaded(self) -> bool:
        return self._model is not None and self._tokenizer is not None

    @property
    def load_error(self) -> Optional[str]:
        return self._load_error

    def get_effective_peers(self) -> List[str]:
        """Return initial_peers merged with any extra peers added at runtime."""
        base = list(self.settings.initial_peers)
        for p in self._extra_peers:
            if p and p not in base:
                base.append(p)
        return base

    def add_peer(self, peer: str) -> None:
        """Add a peer multiaddr for the next load/reload."""
        with self._lock:
            if peer and peer not in self._extra_peers:
                self._extra_peers.append(peer)
                logger.info("Added peer to engine: %s", peer)

    def set_peers(self, peers: List[str]) -> None:
        """Replace the extra peers list (base settings.initial_peers remain)."""
        with self._lock:
            self._extra_peers = [p for p in peers if p]
            logger.info("Set engine extra peers: %s", self._extra_peers)

    def load(self) -> None:
        with self._lock:
            if self.is_loaded:
                return
            effective_peers = self.get_effective_peers()
            if not effective_peers:
                raise RuntimeError(
                    "INITIAL_PEERS is empty. Set it to the VM1 bootstrap multiaddr "
                    "(e.g. /ip4/<VM1_IP>/tcp/31337/p2p/<PEER_ID>)."
                )
            logger.info(
                "Loading Petals client model=%s peers=%s",
                self.settings.model_name,
                effective_peers,
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
                    initial_peers=effective_peers,
                    torch_dtype="auto",
                )
                self._load_error = None
                logger.info("Petals client ready with peers: %s", effective_peers)
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

    def schedule_reload(self, *, delay_seconds: float = 8.0, max_attempts: int = 5) -> None:
        """Reload the Petals client in a background thread after mother shard settles."""

        def _run() -> None:
            if delay_seconds > 0:
                time.sleep(delay_seconds)
            last_exc: Optional[Exception] = None
            for attempt in range(1, max_attempts + 1):
                try:
                    self.reload()
                    logger.info("Background Petals client reload complete (attempt %s)", attempt)
                    return
                except Exception as exc:  # noqa: BLE001
                    last_exc = exc
                    wait = min(30, 4 * attempt)
                    logger.warning(
                        "Background Petals client reload failed (attempt %s/%s): %s; retry in %ss",
                        attempt,
                        max_attempts,
                        exc,
                        wait,
                    )
                    time.sleep(wait)
            logger.exception(
                "Background Petals client reload failed after %s attempts",
                max_attempts,
                exc_info=last_exc,
            )

        threading.Thread(target=_run, name="petals-reload", daemon=True).start()

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
        from orchestrator.app.http_inference import generate_via_contributor_http
        from orchestrator.app.registry import get_registry
        from orchestrator.app.swarm_map import (
            pick_http_inference_host,
            refresh_live_status,
            sync_peers_to_engine,
            validate_manifest,
        )

        registry = get_registry()
        manifest = refresh_live_status(registry)
        ok, detail = validate_manifest(manifest)
        if not ok:
            logger.warning("Swarm manifest incomplete before generate: %s", detail)

        sync_peers_to_engine(registry, self)

        contributor = pick_http_inference_host(manifest)
        if contributor:
            try:
                return generate_via_contributor_http(
                    contributor,
                    manifest,
                    messages,
                    max_tokens=max_tokens,
                    temperature=temperature,
                    top_p=top_p,
                )
            except Exception as exc:  # noqa: BLE001
                logger.error(
                    "HTTP inference via contributor %s failed: %s",
                    contributor.host_id,
                    exc,
                )
                raise HttpInferenceError(
                    f"Distributed HTTP inference via {contributor.host_id} failed: {exc}",
                    host_id=contributor.host_id,
                ) from exc

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

"""Contributor shard manager — Petals supervisor + HTTP-chain inference endpoints."""

from __future__ import annotations

import asyncio
import logging
import os
import signal
import subprocess
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import List, Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from http_chain import HttpChainInference
from local_runner import LocalShardRunner
from tensor_codec import tensor_from_payload, tensor_to_payload

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class ReloadRequest(BaseModel):
    block_indices: str = Field(..., pattern=r"^\d+:\d+$")
    initial_peers: Optional[List[str]] = None


class StatusResponse(BaseModel):
    running: bool
    pid: Optional[int] = None
    block_indices: Optional[str] = None
    model: str
    public_ip: Optional[str] = None
    port: int
    last_exit_code: Optional[int] = None
    identity_path: str
    initial_peers: List[str] = []
    new_swarm: bool = False


class ChatInferenceRequest(BaseModel):
    messages: List[dict]
    max_tokens: int = 64
    temperature: float = 0.7
    top_p: float = 0.9
    swarm_manifest: Optional[dict] = None


class ChatInferenceResponse(BaseModel):
    text: str
    prompt_tokens: int
    completion_tokens: int
    finish_reason: str


class PrefixRequest(BaseModel):
    input_ids: List[int]


class PrefixResponse(BaseModel):
    hidden: dict


class ContinueRequest(BaseModel):
    hidden: dict


class ContinueResponse(BaseModel):
    hidden: dict


class ShardManager:
    def __init__(self) -> None:
        self.model = os.getenv("MODEL_NAME", "HuggingFaceTB/SmolLM2-360M-Instruct")
        self.public_ip = os.getenv("PUBLIC_IP")
        self.port = int(os.getenv("PETALS_PORT", "31337"))
        self.identity_path = os.getenv(
            "IDENTITY_PATH", str(Path.home() / ".blitzwing" / "petals-identity")
        )
        self.device = os.getenv("PETALS_DEVICE", "cpu")
        self.quant_type = os.getenv("PETALS_QUANT_TYPE", "none")
        self.num_handlers = int(os.getenv("PETALS_NUM_HANDLERS", "1"))
        self.python = os.getenv("PETALS_PYTHON", "python")
        peers_raw = os.getenv("INITIAL_PEERS", "")
        self.initial_peers = [p.strip() for p in peers_raw.split(",") if p.strip()]
        announce_raw = os.getenv("ANNOUNCE_MADDRS", "")
        self.announce_maddrs = [a.strip() for a in announce_raw.split(",") if a.strip()]
        self.new_swarm = os.getenv("NEW_SWARM", "0") in ("1", "true", "True")
        self.use_auto_relay = self._resolve_use_auto_relay()
        self.skip_reachability_check = os.getenv(
            "PETALS_SKIP_REACHABILITY_CHECK", "1"
        ) in ("1", "true", "True")
        self.block_indices = os.getenv("BLOCK_INDICES", "0:22")
        self._proc: Optional[subprocess.Popen] = None
        self._lock = threading.Lock()
        self.last_exit_code: Optional[int] = None
        self._auto_start = os.getenv("SHARD_AUTO_START", "1") not in ("0", "false", "False")
        self._bootstrapped = False
        self._log_fp = None
        self.petals_log = os.getenv(
            "PETALS_LOG", str(Path.home() / ".blitzwing" / "petals.log")
        )

    def _resolve_use_auto_relay(self) -> bool:
        raw = os.getenv("PETALS_USE_AUTO_RELAY")
        if raw is not None:
            return raw not in ("0", "false", "False", "no")
        if self.announce_maddrs:
            return False
        return not self.new_swarm

    def build_cmd(self, block_indices: str, *, bootstrap: bool = False) -> List[str]:
        cmd = [
            self.python,
            "-m",
            "petals.cli.run_server",
            self.model,
            "--device",
            self.device,
            "--quant_type",
            self.quant_type,
            "--block_indices",
            block_indices,
            "--port",
            str(self.port),
            "--identity_path",
            self.identity_path,
            "--num_handlers",
            str(self.num_handlers),
        ]
        if self.announce_maddrs:
            cmd.append("--announce_maddrs")
            cmd.extend(self.announce_maddrs)
        elif self.public_ip:
            cmd.extend(["--public_ip", self.public_ip])
        if bootstrap and self.new_swarm:
            cmd.append("--new_swarm")
        elif self.initial_peers and not os.getenv("BLITZWING_HTTP_ONLY"):
            cmd.append("--initial_peers")
            cmd.extend(self.initial_peers)
        if not self.use_auto_relay:
            cmd.append("--no_auto_relay")
        if self.skip_reachability_check:
            cmd.append("--skip_reachability_check")
        return cmd

    def start(self, block_indices: Optional[str] = None, *, bootstrap: bool = False) -> None:
        with self._lock:
            if block_indices:
                self.block_indices = block_indices
            if self._proc and self._proc.poll() is None:
                raise RuntimeError("Petals server already running; call /reload instead")
            use_bootstrap = bootstrap or (self.new_swarm and not self._bootstrapped)
            cmd = self.build_cmd(self.block_indices, bootstrap=use_bootstrap)
            logger.info("Starting Petals: %s", " ".join(cmd))
            if self._log_fp is None:
                Path(self.petals_log).parent.mkdir(parents=True, exist_ok=True)
                self._log_fp = open(self.petals_log, "a", encoding="utf-8")
            popen_kwargs: dict = {
                "stdout": self._log_fp,
                "stderr": subprocess.STDOUT,
            }
            if os.name != "nt":
                popen_kwargs["preexec_fn"] = os.setsid
            self._proc = subprocess.Popen(cmd, **popen_kwargs)
            self.last_exit_code = None
            self._bootstrapped = True

    def stop(self, timeout: float = 30.0) -> None:
        with self._lock:
            if not self._proc or self._proc.poll() is not None:
                self._proc = None
                return
            proc = self._proc
            logger.info("Stopping Petals pid=%s", proc.pid)
            try:
                if os.name == "nt":
                    proc.terminate()
                else:
                    try:
                        os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
                    except ProcessLookupError:
                        proc.send_signal(signal.SIGTERM)
                try:
                    proc.wait(timeout=timeout)
                except subprocess.TimeoutExpired:
                    if os.name != "nt":
                        try:
                            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
                        except ProcessLookupError:
                            proc.kill()
                    else:
                        proc.kill()
                    proc.wait(timeout=10)
            finally:
                self.last_exit_code = proc.returncode
                self._proc = None

    def reload(self, block_indices: str, initial_peers: Optional[List[str]] = None) -> None:
        if initial_peers is not None:
            self.initial_peers = initial_peers
        rebootstrap = self.new_swarm
        logger.info(
            "Reloading Petals with block_indices=%s initial_peers=%s rebootstrap=%s",
            block_indices,
            self.initial_peers,
            rebootstrap,
        )
        self.stop()
        time.sleep(1.0)
        if rebootstrap:
            self._bootstrapped = False
        self.start(block_indices, bootstrap=rebootstrap)

    def status(self) -> StatusResponse:
        running = self._proc is not None and self._proc.poll() is None
        pid = self._proc.pid if running and self._proc else None
        if self._proc and not running:
            self.last_exit_code = self._proc.returncode
        return StatusResponse(
            running=running,
            pid=pid,
            block_indices=self.block_indices,
            model=self.model,
            public_ip=self.public_ip,
            port=self.port,
            last_exit_code=self.last_exit_code,
            identity_path=self.identity_path,
            initial_peers=list(self.initial_peers),
            new_swarm=self.new_swarm,
        )


manager = ShardManager()
app = FastAPI(title="Blitzwing Contributor Shard Manager", version="0.2.0")

_local_runner: Optional[LocalShardRunner] = None
_http_chain: Optional[HttpChainInference] = None
_inference_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="shard-infer")


def _petals_log_path() -> str:
    return manager.petals_log


def _reset_inference_caches() -> None:
    global _local_runner, _http_chain
    if _local_runner is not None or _http_chain is not None:
        logger.info("Resetting inference caches (blocks=%s)", manager.block_indices)
    _local_runner = None
    _http_chain = None


def _get_local_runner() -> LocalShardRunner:
    global _local_runner
    blocks = manager.block_indices
    if _local_runner is not None:
        current = f"{_local_runner.block_start}:{_local_runner.block_end}"
        if current != blocks:
            logger.warning(
                "LocalShardRunner stale (%s != %s); recreating",
                current,
                blocks,
            )
            _reset_inference_caches()
    if _local_runner is None:
        _local_runner = LocalShardRunner(
            manager.model,
            blocks,
            local_port=manager.port,
            log_path=_petals_log_path(),
        )
    return _local_runner


def _get_http_chain() -> HttpChainInference:
    global _http_chain
    if _http_chain is None:
        _http_chain = HttpChainInference(
            runner=_get_local_runner(),
            local_block_indices=manager.block_indices,
        )
    return _http_chain


def _prewarm_local_runner() -> None:
    for _ in range(120):
        if manager.status().running:
            break
        time.sleep(2)
    try:
        _get_local_runner()
        logger.info("LocalShardRunner pre-warmed for HTTP chain")
    except Exception:  # noqa: BLE001
        logger.exception("LocalShardRunner pre-warm failed")


@app.on_event("startup")
def on_startup() -> None:
    manager.last_exit_code = None
    if manager._auto_start:
        try:
            manager.start(bootstrap=manager.new_swarm)
        except Exception:  # noqa: BLE001
            logger.exception("Failed to auto-start Petals server")
    threading.Thread(
        target=_prewarm_local_runner, name="prefix-prewarm", daemon=True
    ).start()


@app.on_event("shutdown")
def on_shutdown() -> None:
    manager.stop()


@app.get("/health")
def health() -> dict:
    st = manager.status()
    return {"status": "ok" if st.running else "degraded", "running": st.running}


@app.get("/status", response_model=StatusResponse)
def status() -> StatusResponse:
    return manager.status()


@app.post("/reload", response_model=StatusResponse)
def reload(body: ReloadRequest) -> StatusResponse:
    start, end = map(int, body.block_indices.split(":"))
    if end <= start:
        raise HTTPException(status_code=400, detail="block_indices end must be > start")
    try:
        manager.reload(body.block_indices, initial_peers=body.initial_peers)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    _reset_inference_caches()
    threading.Thread(
        target=_prewarm_local_runner, name="prefix-prewarm", daemon=True
    ).start()
    time.sleep(0.5)
    return manager.status()


@app.post("/stop", response_model=StatusResponse)
def stop() -> StatusResponse:
    manager.stop()
    return manager.status()


@app.post("/v1/chain/prefix", response_model=PrefixResponse)
async def chain_prefix(body: PrefixRequest) -> PrefixResponse:
    st = manager.status()
    if not st.running:
        raise HTTPException(status_code=503, detail="Petals server not running")

    def _run() -> PrefixResponse:
        import torch

        runner = _get_local_runner()
        input_ids = torch.tensor([body.input_ids], dtype=torch.long)
        hidden = runner.forward_prefix(input_ids)
        return PrefixResponse(hidden=tensor_to_payload(hidden))

    try:
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(_inference_executor, _run)
    except Exception as exc:  # noqa: BLE001
        logger.exception("HTTP prefix forward failed")
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.post("/v1/chain/continue", response_model=ContinueResponse)
async def chain_continue(body: ContinueRequest) -> ContinueResponse:
    st = manager.status()
    if not st.running:
        raise HTTPException(status_code=503, detail="Petals server not running")

    def _run() -> ContinueResponse:
        runner = _get_local_runner()
        hidden = tensor_from_payload(body.hidden)
        hidden = runner.forward_tail(hidden)
        return ContinueResponse(hidden=tensor_to_payload(hidden))

    try:
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(_inference_executor, _run)
    except Exception as exc:  # noqa: BLE001
        logger.exception("HTTP chain continue failed")
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.post("/v1/chat/completions", response_model=ChatInferenceResponse)
async def chat_completions(body: ChatInferenceRequest) -> ChatInferenceResponse:
    st = manager.status()
    if not st.running:
        raise HTTPException(status_code=503, detail="Petals server not running")
    if not body.swarm_manifest:
        raise HTTPException(
            status_code=400,
            detail="swarm_manifest required for distributed HTTP inference",
        )

    def _run() -> ChatInferenceResponse:
        result = _get_http_chain().generate(
            body.messages,
            max_tokens=body.max_tokens,
            temperature=body.temperature,
            top_p=body.top_p,
            swarm_manifest=body.swarm_manifest,
        )
        return ChatInferenceResponse(
            text=result.text,
            prompt_tokens=result.prompt_tokens,
            completion_tokens=result.completion_tokens,
            finish_reason=result.finish_reason,
        )

    try:
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(_inference_executor, _run)
    except Exception as exc:  # noqa: BLE001
        logger.exception("Contributor HTTP-chained inference failed")
        raise HTTPException(status_code=503, detail=str(exc)) from exc

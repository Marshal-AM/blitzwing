"""Shard manager — supervise a Petals server subprocess and reload block ranges."""

from __future__ import annotations

import logging
import os
import signal
import subprocess
import threading
import time
from pathlib import Path
from typing import List, Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from shard_manager.inference import get_contributor_inference, warm_contributor_inference_async
from shard_manager.heartbeat import maybe_start_from_env

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


class ShardManager:
    def __init__(self) -> None:
        self.model = os.getenv("MODEL_NAME", "TinyLlama/TinyLlama-1.1B-Chat-v1.0")
        self.public_ip = os.getenv("PUBLIC_IP")
        self.port = int(os.getenv("PETALS_PORT", "31337"))
        self.identity_path = os.getenv("IDENTITY_PATH", str(Path.home() / "petals-identity"))
        self.device = os.getenv("PETALS_DEVICE", "cpu")
        self.quant_type = os.getenv("PETALS_QUANT_TYPE", "none")
        self.num_handlers = int(os.getenv("PETALS_NUM_HANDLERS", "1"))
        self.python = os.getenv("PETALS_PYTHON", "python")
        peers_raw = os.getenv("INITIAL_PEERS", "")
        self.initial_peers = [p.strip() for p in peers_raw.split(",") if p.strip()]
        # Comma-separated multiaddrs; preferred over PUBLIC_IP when set (avoids NAT hairpin).
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

    def _resolve_use_auto_relay(self) -> bool:
        """NAT contributors default to libp2p auto-relay; explicit announce disables it."""
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
        # Prefer explicit announce list (local + ngrok) over a single PUBLIC_IP.
        if self.announce_maddrs:
            cmd.append("--announce_maddrs")
            cmd.extend(self.announce_maddrs)
        elif self.public_ip:
            cmd.extend(["--public_ip", self.public_ip])
        if bootstrap and self.new_swarm:
            cmd.append("--new_swarm")
        elif self.initial_peers:
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
            popen_kwargs: dict = {}
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
        # Mother swarms (NEW_SWARM=1) must re-bootstrap after stop — dialing their own
        # public multiaddr as initial_peers fails (NAT hairpin / self-dial).
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
app = FastAPI(title="Blitzwing Shard Manager", version="0.1.0")


@app.on_event("startup")
def on_startup() -> None:
    maybe_start_from_env(manager)
    if manager._auto_start:
        try:
            manager.start(bootstrap=manager.new_swarm)
        except Exception:  # noqa: BLE001
            logger.exception("Failed to auto-start Petals server")
        # Warm Petals client + DHT in background (contributors only — mother has initial_peers empty / new_swarm).
        if manager.initial_peers and not manager.new_swarm:
            log_path = os.getenv(
                "CONTRIB_SHARD_LOG",
                str(Path.home() / ".blitzwing" / "contrib_shard.out"),
            )
            warm_contributor_inference_async(
                manager.model,
                list(manager.initial_peers),
                local_port=manager.port,
                log_path=log_path,
                delay_seconds=3.0,
            )


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
    # Give process a moment to spawn
    time.sleep(0.5)
    return manager.status()


@app.post("/stop", response_model=StatusResponse)
def stop() -> StatusResponse:
    manager.stop()
    return manager.status()


@app.post("/start", response_model=StatusResponse)
def start(body: Optional[ReloadRequest] = None) -> StatusResponse:
    try:
        manager.start(body.block_indices if body else None)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return manager.status()


@app.post("/v1/chat/completions", response_model=ChatInferenceResponse)
def chat_completions(body: ChatInferenceRequest) -> ChatInferenceResponse:
    """
    Run full-model inference on this contributor over HTTP.
    The contributor Petals client reaches mother blocks via libp2p (outbound);
    tail blocks are served locally — no inbound libp2p from mother required.
    """
    st = manager.status()
    if not st.running:
        raise HTTPException(status_code=503, detail="Petals server not running")
    try:
        inf = get_contributor_inference(
            st.model,
            list(st.initial_peers),
            local_port=st.port,
            local_block_indices=st.block_indices,
        )
        result = inf.generate(
            body.messages,
            max_tokens=body.max_tokens,
            temperature=body.temperature,
            top_p=body.top_p,
            swarm_manifest=body.swarm_manifest,
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception("Contributor HTTP inference failed")
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return ChatInferenceResponse(
        text=result.text,
        prompt_tokens=result.prompt_tokens,
        completion_tokens=result.completion_tokens,
        finish_reason=result.finish_reason,
    )

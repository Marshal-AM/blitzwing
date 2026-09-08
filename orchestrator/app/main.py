"""FastAPI OpenAI-compatible chat completions + host join/rebalance APIs."""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from typing import AsyncIterator, Optional

import httpx
from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import StreamingResponse

from orchestrator.app.config import get_settings
from orchestrator.app.engine import get_engine, new_completion_id, now_ts
from orchestrator.app.errors import MissingBlocksServiceError
from orchestrator.app.hedera_payouts import get_payout_service
from orchestrator.app.registry import get_registry, init_registry
from orchestrator.app.swarm_verify import verify_blocks_visible
from orchestrator.app.schemas import (
    ChatCompletionChunk,
    ChatCompletionRequest,
    ChatCompletionResponse,
    Choice,
    ChoiceMessage,
    Delta,
    HealthResponse,
    HostHeartbeatRequest,
    HostJoinRequest,
    HostJoinResponse,
    HostLeaveRequest,
    HostListResponse,
    HostPublic,
    HostReadyRequest,
    InternalPayoutRequest,
    ModelCard,
    ModelList,
    StreamChoice,
    Usage,
)
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

_reaper_task: Optional[asyncio.Task] = None


def _sync_mother_shard_blocks(registry, shard_url: str) -> None:
    try:
        with httpx.Client(timeout=15.0) as client:
            resp = client.get(f"{shard_url.rstrip('/')}/status")
            resp.raise_for_status()
            blocks = resp.json().get("block_indices")
            if blocks:
                registry.sync_mother_from_shard(blocks)
                logger.info("Synced mother registry blocks to %s", blocks)
    except Exception:  # noqa: BLE001
        logger.warning("Could not sync mother blocks from shard manager", exc_info=True)


async def _reaper_loop() -> None:
    settings = get_settings()
    while True:
        await asyncio.sleep(30)
        try:
            registry = get_registry()
            reaped = await asyncio.to_thread(registry.reap_stale, settings.heartbeat_ttl_seconds)
            if reaped:
                logger.info("Reaped stale hosts: %s", reaped)
        except Exception:  # noqa: BLE001
            logger.exception("Heartbeat reaper error")


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _reaper_task
    settings = get_settings()
    registry = init_registry(
        settings.model_name,
        settings.total_layers,
        settings.mother_shard_manager_url,
        mother_hedera_account_id=settings.mother_account_id,
    )
    if settings.announce_peers:
        registry.set_bootstrap_peers(settings.announce_peers)
    elif settings.initial_peers:
        registry.set_bootstrap_peers(settings.initial_peers)

    await asyncio.to_thread(
        _sync_mother_shard_blocks, registry, settings.mother_shard_manager_url
    )

    if settings.x402_enabled:
        if not settings.mother_account_id or not settings.mother_private_key:
            logger.warning("X402_ENABLED but MOTHER_ACCOUNT_ID / MOTHER_PRIVATE_KEY missing")
        elif settings.cost_per_layer_tinybars <= 0:
            logger.warning("X402_ENABLED but COST_PER_LAYER_TINYBARS is not set")
        else:
            try:
                await asyncio.to_thread(get_payout_service(settings).ensure_hcs_topic)
            except Exception:  # noqa: BLE001
                logger.exception("HCS topic bootstrap failed (payouts may still work)")

    engine = get_engine()
    if settings.load_at_startup:
        if not settings.initial_peers:
            logger.warning(
                "LOAD_AT_STARTUP is set but INITIAL_PEERS is empty; "
                "deferring Petals client load until peers are set / first request."
            )
        else:
            try:
                await asyncio.to_thread(engine.load)
            except Exception:  # noqa: BLE001
                logger.exception(
                    "Startup model load failed; /health will report not ready. "
                    "Fix INITIAL_PEERS / swarm and retry a request."
                )

    _reaper_task = asyncio.create_task(_reaper_loop())
    yield
    if _reaper_task:
        _reaper_task.cancel()
        try:
            await _reaper_task
        except asyncio.CancelledError:
            pass


app = FastAPI(
    title="Blitzwing Petals Orchestrator",
    version="0.3.0",
    description="OpenAI-compatible chat completions + mother swarm host registry + x402 Hedera payments.",
    lifespan=lifespan,
)


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    settings = get_settings()
    engine = get_engine()
    try:
        registry = get_registry()
        max_layers = registry.max_carveable()
    except Exception:  # noqa: BLE001
        max_layers = None
    status = "ok" if engine.is_loaded else "degraded"
    return HealthResponse(
        status=status,
        model=settings.model_name,
        model_loaded=engine.is_loaded,
        initial_peers=list(settings.initial_peers),
        detail=engine.load_error,
        max_layers_available=max_layers,
        total_layers=settings.total_layers,
        cost_per_layer_tinybars=settings.cost_per_layer_tinybars or None,
        x402_enabled=settings.x402_enabled,
    )


@app.get("/v1/models", response_model=ModelList)
async def list_models() -> ModelList:
    settings = get_settings()
    return ModelList(
        data=[
            ModelCard(
                id=settings.model_name,
                created=now_ts(),
                owned_by="blitzwing",
            )
        ]
    )


@app.get("/v1/hosts", response_model=HostListResponse)
async def list_hosts() -> HostListResponse:
    settings = get_settings()
    registry = get_registry()
    hosts = [
        HostPublic(
            host_id=h.host_id,
            role=h.role,
            model=h.model,
            block_indices=h.block_indices,
            layers_hosted=h.layers_hosted,
            status=h.status,
            public_ip=h.public_ip,
            last_heartbeat=h.last_heartbeat,
            hedera_account_id=h.hedera_account_id,
        )
        for h in registry.list_hosts()
    ]
    return HostListResponse(
        model=settings.model_name,
        total_layers=settings.total_layers,
        max_layers_available=registry.max_carveable(),
        cost_per_layer_tinybars=settings.cost_per_layer_tinybars or None,
        hosts=hosts,
    )


@app.post("/v1/hosts/join", response_model=HostJoinResponse)
async def hosts_join(body: HostJoinRequest) -> HostJoinResponse:
    settings = get_settings()
    if body.model != settings.model_name:
        raise HTTPException(
            status_code=400,
            detail=f"This mother serves '{settings.model_name}', not '{body.model}'",
        )
    registry = get_registry()
    try:
        result = await asyncio.to_thread(
            registry.join,
            layers=body.layers,
            public_ip=body.public_ip,
            shard_manager_url=body.shard_manager_url,
            hedera_account_id=body.hedera_account_id,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail={"message": str(exc), "max_layers": registry.max_carveable()},
        ) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("join failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return HostJoinResponse(**result)


@app.post("/v1/hosts/ready")
async def hosts_ready(body: HostReadyRequest) -> dict:
    """
    Finalize contributor handoff. Reordered flow for reliability:
    1. Inject contributor peer into engine
    2. Reload engine (fail if this fails)
    3. Verify blocks visible in DHT (with fresh peer knowledge)
    4. Mark host as online in registry
    """
    settings = get_settings()
    registry = get_registry()
    engine = get_engine()
    try:
        pending = await asyncio.to_thread(registry.get_host, body.host_id)
        if pending.status == "online":
            return {
                "host_id": pending.host_id,
                "status": pending.status,
                "block_indices": pending.block_indices,
                "layers_hosted": pending.layers_hosted,
                "hedera_account_id": pending.hedera_account_id,
            }
        block_range = pending.pending_range or pending.block_indices

        # Step 1: Inject contributor peer into engine for reload
        if body.peer_multiaddr:
            logger.info("Injecting contributor peer %s into engine", body.peer_multiaddr)
            engine.add_peer(body.peer_multiaddr)

        # Step 2: Reload engine with new peer — FAIL if this fails
        try:
            await asyncio.to_thread(engine.reload)
            logger.info("Petals client reloaded with contributor peer for %s", body.host_id)
        except Exception as reload_exc:
            logger.exception("Engine reload failed for %s — aborting handoff", body.host_id)
            raise RuntimeError(
                f"Petals client reload failed after adding peer: {reload_exc}. "
                "Check contributor peer reachability and try again."
            ) from reload_exc

        # Step 3: Verify blocks visible in DHT (with fresh peer knowledge)
        if not settings.skip_ready_verify:
            await asyncio.to_thread(
                verify_blocks_visible,
                engine,
                block_range,
                timeout_seconds=settings.ready_verify_timeout_seconds,
            )
        else:
            logger.warning("SKIP_READY_VERIFY=1 — accepting handoff without DHT check")

        # Step 4: Mark host as online in registry and shrink donor
        host = await asyncio.to_thread(registry.mark_ready, body.host_id, body.peer_multiaddr)
        logger.info("Handoff complete: %s is online with blocks %s", body.host_id, host.block_indices)

    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except RuntimeError as exc:
        try:
            await asyncio.to_thread(registry.leave, body.host_id)
        except Exception:  # noqa: BLE001
            logger.exception("Failed to release pending host %s after verify failure", body.host_id)
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("ready/handoff failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {
        "host_id": host.host_id,
        "status": host.status,
        "block_indices": host.block_indices,
        "layers_hosted": host.layers_hosted,
        "hedera_account_id": host.hedera_account_id,
    }


@app.post("/v1/internal/payout")
async def internal_payout(
    body: InternalPayoutRequest,
    x402_tx_id: Optional[str] = Header(default=None, alias="X-Blitzwing-X402-Tx-Id"),
    blitzwing_paid: Optional[str] = Header(default=None, alias="X-Blitzwing-Paid"),
) -> dict:
    """Called by x402 gateway after settlement to redistribute HBAR to hosts."""
    settings = get_settings()
    if settings.x402_enabled and blitzwing_paid != "1":
        raise HTTPException(status_code=403, detail="Settlement required before payout")
    try:
        receipt = await asyncio.to_thread(_run_payout, body.request_id, x402_tx_id)
    except Exception as exc:  # noqa: BLE001
        logger.exception("Internal payout failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    if receipt is None:
        raise HTTPException(status_code=503, detail="Payout service disabled or misconfigured")
    return receipt


@app.post("/v1/hosts/heartbeat")
async def hosts_heartbeat(body: HostHeartbeatRequest) -> dict:
    registry = get_registry()
    try:
        host = registry.heartbeat(body.host_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"host_id": host.host_id, "last_heartbeat": host.last_heartbeat}


@app.post("/v1/hosts/leave")
async def hosts_leave(body: HostLeaveRequest) -> dict:
    registry = get_registry()
    try:
        await asyncio.to_thread(registry.leave, body.host_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("leave/reclaim failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"left": body.host_id}


def _messages_as_dicts(request: ChatCompletionRequest) -> list:
    return [m.model_dump() for m in request.messages]


async def _ensure_model_or_400(request: ChatCompletionRequest) -> None:
    settings = get_settings()
    if request.model and request.model != settings.model_name:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Unsupported model '{request.model}'. "
                f"This orchestrator serves '{settings.model_name}'."
            ),
        )
    if not request.messages:
        raise HTTPException(status_code=400, detail="messages must be a non-empty list")


def _run_payout(completion_id: str, x402_tx_id: Optional[str]) -> Optional[dict]:
    """Layer-weighted HBAR redistribution after inference (post x402 settle)."""
    settings = get_settings()
    payouts = get_payout_service(settings)
    if not payouts.enabled:
        return None
    registry = get_registry()
    hosts = registry.online_payout_hosts()
    receipt = payouts.redistribute(
        request_id=completion_id,
        hosts=hosts,
        x402_tx_id=x402_tx_id,
    )
    return payouts.receipt_dict(receipt)


@app.post("/v1/chat/completions")
async def chat_completions(
    request: ChatCompletionRequest,
    x402_tx_id: Optional[str] = Header(default=None, alias="X-Blitzwing-X402-Tx-Id"),
    blitzwing_paid: Optional[str] = Header(default=None, alias="X-Blitzwing-Paid"),
):
    """
    Inference + host payouts.

    Payment verify/settle happens in packages/x402-gateway (@x402/core + @x402/hedera).
    The gateway forwards X-Blitzwing-Paid=1 and X-Blitzwing-X402-Tx-Id after settlement.
    """
    settings = get_settings()
    if settings.x402_enabled and blitzwing_paid not in ("1", "verified"):
        raise HTTPException(
            status_code=403,
            detail=(
                "Chat is x402-gated. Call the public gateway on :8000 "
                "(packages/x402-gateway); do not hit the internal orchestrator directly."
            ),
        )
    run_payout = settings.x402_enabled and blitzwing_paid == "1"
    await _ensure_model_or_400(request)
    engine = get_engine()
    completion_id = new_completion_id()
    created = now_ts()
    messages = _messages_as_dicts(request)

    if request.stream:
        async def _paid_stream() -> AsyncIterator[str]:
            async for chunk in _stream_sse(
                engine=engine,
                messages=messages,
                request=request,
                completion_id=completion_id,
                created=created,
                model=settings.model_name,
            ):
                yield chunk
            try:
                if run_payout:
                    await asyncio.to_thread(_run_payout, completion_id, x402_tx_id)
            except Exception:  # noqa: BLE001
                logger.exception("Post-stream payout failed")

        headers = {
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
        return StreamingResponse(_paid_stream(), media_type="text/event-stream", headers=headers)

    try:
        result = await asyncio.wait_for(
            asyncio.to_thread(
                engine.generate,
                messages,
                max_tokens=request.max_tokens,
                temperature=request.temperature,
                top_p=request.top_p,
                stop=request.stop,
            ),
            timeout=settings.inference_timeout_seconds,
        )
    except asyncio.TimeoutError:
        raise HTTPException(
            status_code=503,
            detail=(
                f"Inference timed out after {settings.inference_timeout_seconds}s. "
                "Swarm blocks may be unreachable."
            ),
        ) from None
    except MissingBlocksServiceError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("Generation failed")
        raise HTTPException(status_code=500, detail=f"Generation failed: {exc}") from exc

    payment_receipt = None
    if run_payout:
        try:
            payment_receipt = await asyncio.to_thread(_run_payout, completion_id, x402_tx_id)
        except Exception:  # noqa: BLE001
            logger.exception("Host redistribution failed after successful inference")

    return ChatCompletionResponse(
        id=completion_id,
        created=created,
        model=settings.model_name,
        choices=[
            Choice(
                index=0,
                message=ChoiceMessage(role="assistant", content=result.text),
                finish_reason=result.finish_reason,
            )
        ],
        usage=Usage(
            prompt_tokens=result.prompt_tokens,
            completion_tokens=result.completion_tokens,
            total_tokens=result.prompt_tokens + result.completion_tokens,
        ),
        blitzwing_payment=payment_receipt,
    )


async def _stream_sse(
    *,
    engine,
    messages: list,
    request: ChatCompletionRequest,
    completion_id: str,
    created: int,
    model: str,
) -> AsyncIterator[str]:
    first = ChatCompletionChunk(
        id=completion_id,
        created=created,
        model=model,
        choices=[StreamChoice(index=0, delta=Delta(role="assistant", content=""), finish_reason=None)],
    )
    yield f"data: {first.model_dump_json()}\n\n"

    queue: asyncio.Queue[Optional[object]] = asyncio.Queue()
    loop = asyncio.get_running_loop()

    def _producer() -> None:
        try:
            gen = engine.stream_generate(
                messages,
                max_tokens=request.max_tokens,
                temperature=request.temperature,
                top_p=request.top_p,
                stop=request.stop,
            )
            try:
                while True:
                    piece = next(gen)
                    loop.call_soon_threadsafe(queue.put_nowait, ("delta", piece))
            except StopIteration as stop:
                result = stop.value
                loop.call_soon_threadsafe(queue.put_nowait, ("done", result))
        except Exception as exc:  # noqa: BLE001
            loop.call_soon_threadsafe(queue.put_nowait, ("error", exc))

    producer = loop.run_in_executor(None, _producer)

    finish_reason = "stop"
    try:
        while True:
            kind, payload = await queue.get()
            if kind == "delta":
                chunk = ChatCompletionChunk(
                    id=completion_id,
                    created=created,
                    model=model,
                    choices=[
                        StreamChoice(
                            index=0,
                            delta=Delta(content=str(payload)),
                            finish_reason=None,
                        )
                    ],
                )
                yield f"data: {chunk.model_dump_json()}\n\n"
            elif kind == "done":
                if payload is not None:
                    finish_reason = getattr(payload, "finish_reason", "stop")
                break
            elif kind == "error":
                err = ChatCompletionChunk(
                    id=completion_id,
                    created=created,
                    model=model,
                    choices=[
                        StreamChoice(
                            index=0,
                            delta=Delta(content=f"\n\n[error] {payload}"),
                            finish_reason="stop",
                        )
                    ],
                )
                yield f"data: {err.model_dump_json()}\n\n"
                yield "data: [DONE]\n\n"
                await producer
                return
    finally:
        await producer

    final = ChatCompletionChunk(
        id=completion_id,
        created=created,
        model=model,
        choices=[StreamChoice(index=0, delta=Delta(), finish_reason=finish_reason)],
    )
    yield f"data: {final.model_dump_json()}\n\n"
    yield "data: [DONE]\n\n"


def create_app() -> FastAPI:
    return app

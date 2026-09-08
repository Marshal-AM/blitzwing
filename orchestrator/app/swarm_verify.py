"""Verify contributor blocks are visible in the Petals DHT before handoff."""

from __future__ import annotations

import logging
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeout
from typing import TYPE_CHECKING

from orchestrator.app.registry import parse_range

if TYPE_CHECKING:
    from orchestrator.app.engine import PetalsEngine

logger = logging.getLogger(__name__)

_UPDATE_TIMEOUT_SECONDS = 45.0


def _sequence_manager(model):
    """Return RemoteSequenceManager from a distributed causal LM."""
    if hasattr(model, "model") and hasattr(model.model, "layers"):
        return model.model.layers.sequence_manager
    if hasattr(model, "transformer") and hasattr(model.transformer, "h"):
        return model.transformer.h.sequence_manager
    raise RuntimeError("Could not locate Petals sequence manager on model")


def _update_with_timeout(sm, timeout_seconds: float) -> None:
    """sm.update(wait=True) can block indefinitely; bound each poll."""
    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(sm.update, wait=True)
        try:
            future.result(timeout=timeout_seconds)
        except FuturesTimeout:
            logger.warning("DHT update timed out after %.0fs", timeout_seconds)
            raise TimeoutError(f"DHT update timed out after {timeout_seconds}s")


def verify_blocks_visible(
    engine: "PetalsEngine",
    block_indices: str,
    *,
    timeout_seconds: float = 120,
    poll_interval: float = 5,
) -> None:
    """
    Poll the swarm DHT until every block in block_indices has at least one server span.

    Raises RuntimeError if blocks are not routable within timeout.
    """
    start, end = parse_range(block_indices)
    engine._ensure_loaded()
    assert engine._model is not None
    sm = _sequence_manager(engine._model)
    deadline = time.time() + timeout_seconds
    last_missing: list[int] = []

    while time.time() < deadline:
        try:
            _update_with_timeout(sm, _UPDATE_TIMEOUT_SECONDS)
        except TimeoutError:
            logger.warning("DHT update poll timed out for blocks %s", block_indices)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Swarm verify poll error: %s", exc)
        try:
            missing = [
                idx
                for idx in range(start, end)
                if not sm.state.sequence_info.spans_containing_block[idx]
            ]
            last_missing = missing
            if not missing:
                logger.info("Swarm verify OK for blocks %s", block_indices)
                return
            logger.info(
                "Waiting for blocks %s in DHT (missing %s)",
                block_indices,
                missing,
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("Swarm verify span check error: %s", exc)
        time.sleep(poll_interval)

    raise RuntimeError(
        f"Blocks {block_indices} not reachable in swarm after {timeout_seconds}s "
        f"(still missing indices {last_missing}). "
        "Contributor may be behind NAT without relay, or Petals is still loading."
    )

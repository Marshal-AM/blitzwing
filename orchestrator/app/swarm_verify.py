"""Verify contributor blocks are visible in the Petals DHT before handoff."""

from __future__ import annotations

import logging
import time
from typing import TYPE_CHECKING

from orchestrator.app.registry import parse_range

if TYPE_CHECKING:
    from orchestrator.app.engine import PetalsEngine

logger = logging.getLogger(__name__)


def _sequence_manager(model):
    """Return RemoteSequenceManager from a distributed causal LM."""
    if hasattr(model, "model") and hasattr(model.model, "layers"):
        return model.model.layers.sequence_manager
    if hasattr(model, "transformer") and hasattr(model.transformer, "h"):
        return model.transformer.h.sequence_manager
    raise RuntimeError("Could not locate Petals sequence manager on model")


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
            sm.update(wait=True)
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
            logger.warning("Swarm verify poll error: %s", exc)
        time.sleep(poll_interval)

    raise RuntimeError(
        f"Blocks {block_indices} not reachable in swarm after {timeout_seconds}s "
        f"(still missing indices {last_missing}). "
        "Contributor may be behind NAT without relay, or Petals is still loading."
    )

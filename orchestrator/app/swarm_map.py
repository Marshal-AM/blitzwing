"""Authoritative layer map — mother registry is the source of truth for routing."""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

import httpx

from orchestrator.app.registry import HostRecord, SwarmRegistry, format_range, parse_range

logger = logging.getLogger(__name__)


@dataclass
class LayerSpan:
    host_id: str
    role: str
    block_indices: str
    start: int
    end: int
    shard_manager_url: str
    peer_multiaddr: Optional[str] = None
    petals_running: Optional[bool] = None


@dataclass
class SwarmManifest:
    model: str
    total_layers: int
    spans: List[LayerSpan]

    def to_dict(self) -> dict:
        return {
            "model": self.model,
            "total_layers": self.total_layers,
            "hosts": [
                {
                    "host_id": s.host_id,
                    "role": s.role,
                    "block_indices": s.block_indices,
                    "layers_hosted": s.end - s.start,
                    "shard_manager_url": s.shard_manager_url,
                    "peer_multiaddr": s.peer_multiaddr,
                    "petals_running": s.petals_running,
                }
                for s in self.spans
            ],
        }

    def peer_multiaddrs(self) -> List[str]:
        peers: List[str] = []
        for span in self.spans:
            if span.peer_multiaddr and span.peer_multiaddr not in peers:
                peers.append(span.peer_multiaddr)
        return peers

    def tail_contributor(self) -> Optional[LayerSpan]:
        """Return the online contributor holding the highest block range (tail)."""
        contributors = [s for s in self.spans if s.role == "contributor"]
        if not contributors:
            return None
        return max(contributors, key=lambda s: s.end)

    def is_complete(self) -> bool:
        """True when online spans cover 0:total_layers with no gaps or overlaps."""
        online = [s for s in self.spans if s.end > s.start]
        if not online:
            return False
        online.sort(key=lambda s: s.start)
        expected = 0
        for span in online:
            if span.start != expected:
                return False
            expected = span.end
        return expected == self.total_layers


def build_manifest(registry: SwarmRegistry) -> SwarmManifest:
    spans: List[LayerSpan] = []
    for host in registry.list_hosts():
        if host.status != "online":
            continue
        start, end = parse_range(host.block_indices)
        spans.append(
            LayerSpan(
                host_id=host.host_id,
                role=host.role,
                block_indices=host.block_indices,
                start=start,
                end=end,
                shard_manager_url=host.shard_manager_url,
                peer_multiaddr=host.peer_multiaddr,
            )
        )
    spans.sort(key=lambda s: s.start)
    return SwarmManifest(
        model=registry.model,
        total_layers=registry.total_layers,
        spans=spans,
    )


def validate_manifest(manifest: SwarmManifest) -> Tuple[bool, str]:
    if not manifest.spans:
        return False, "no online hosts"
    if not manifest.is_complete():
        covered = [(s.start, s.end) for s in manifest.spans]
        return False, f"layer map not contiguous 0:{manifest.total_layers} — have {covered}"
    return True, "ok"


def _is_public_http_url(url: str) -> bool:
    if not url:
        return False
    lower = url.lower()
    if lower.startswith("http://127.") or lower.startswith("http://localhost"):
        return False
    if url.startswith("http://172.") or url.startswith("http://192.168."):
        return False
    return url.startswith("http://") or url.startswith("https://")


def pick_http_inference_host(manifest: SwarmManifest) -> Optional[LayerSpan]:
    """
    Route full inference to the tail contributor when it has a public HTTP endpoint.
    The contributor reaches mother blocks outbound via libp2p; mother avoids NAT inbound.
    """
    tail = manifest.tail_contributor()
    if not tail:
        return None
    if not _is_public_http_url(tail.shard_manager_url):
        return None
    return tail


def sync_peers_to_engine(registry: SwarmRegistry, engine) -> List[str]:
    """Push registry-known peer multiaddrs into the Petals engine before inference."""
    manifest = build_manifest(registry)
    peers = manifest.peer_multiaddrs()
    bootstrap = list(registry.bootstrap_peers or [])
    for p in bootstrap:
        if p and p not in peers:
            peers.append(p)
    engine.set_peers(peers)
    return peers


def _fetch_shard_status(url: str, timeout: float = 5.0) -> Optional[dict]:
    try:
        with httpx.Client(timeout=timeout) as client:
            resp = client.get(f"{url.rstrip('/')}/status")
            resp.raise_for_status()
            return resp.json()
    except Exception as exc:  # noqa: BLE001
        logger.warning("Shard status probe failed for %s: %s", url, exc)
        return None


def refresh_live_status(registry: SwarmRegistry, *, timeout: float = 5.0) -> SwarmManifest:
    """
    Probe each online host's shard manager and reconcile layer ownership with the registry.
    Called before routing a chat request so the mother stays the source of truth.
    """
    drift_hosts: List[str] = []
    with registry._lock:  # noqa: SLF001 — intentional registry reconcile
        online_hosts = [h for h in registry.hosts.values() if h.status == "online"]

    for host in online_hosts:
        status = _fetch_shard_status(host.shard_manager_url, timeout=timeout)
        if status is None:
            continue
        live_blocks = status.get("block_indices")
        live_running = bool(status.get("running"))
        if live_blocks and live_blocks != host.block_indices:
            logger.warning(
                "Layer drift for %s: registry=%s live=%s — adopting live status",
                host.host_id,
                host.block_indices,
                live_blocks,
            )
            drift_hosts.append(host.host_id)
            with registry._lock:  # noqa: SLF001
                h = registry.hosts.get(host.host_id)
                if h:
                    start, end = parse_range(live_blocks)
                    h.block_indices = live_blocks
                    h.layers_hosted = end - start
        with registry._lock:  # noqa: SLF001
            h = registry.hosts.get(host.host_id)
            if h:
                h.petals_running = live_running

    if drift_hosts:
        registry.persist()
        logger.info("Reconciled layer drift for hosts: %s", drift_hosts)

    return build_manifest(registry)


def apply_heartbeat_manifest(
    registry: SwarmRegistry,
    host_id: str,
    *,
    block_indices: Optional[str] = None,
    petals_running: Optional[bool] = None,
    peer_multiaddr: Optional[str] = None,
    shard_manager_url: Optional[str] = None,
) -> HostRecord:
    """Update host liveness and layer report from contributor heartbeat."""
    with registry._lock:  # noqa: SLF001
        host = registry.hosts.get(host_id)
        if not host:
            raise KeyError(host_id)
        host.last_heartbeat = int(time.time())
        if host.status == "offline":
            host.status = "online"

        if block_indices and block_indices != host.block_indices:
            logger.info(
                "Heartbeat layer report for %s: %s -> %s",
                host_id,
                host.block_indices,
                block_indices,
            )
            start, end = parse_range(block_indices)
            host.block_indices = block_indices
            host.layers_hosted = end - start
        if shard_manager_url:
            host.shard_manager_url = shard_manager_url.rstrip("/")
        if peer_multiaddr:
            host.peer_multiaddr = peer_multiaddr
            if peer_multiaddr not in registry.bootstrap_peers:
                from orchestrator.app.registry import is_public_multiaddr

                if is_public_multiaddr(peer_multiaddr):
                    registry.bootstrap_peers.append(peer_multiaddr)
        if petals_running is not None:
            host.petals_running = petals_running
        return host

"""In-memory host registry, layer carve, and donor shrink/reclaim."""

from __future__ import annotations

import logging
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

import httpx

logger = logging.getLogger(__name__)


def parse_range(block_indices: str) -> Tuple[int, int]:
    start_s, end_s = block_indices.split(":")
    return int(start_s), int(end_s)


def format_range(start: int, end: int) -> str:
    return f"{start}:{end}"


def validate_hedera_account_id(account_id: str) -> str:
    value = (account_id or "").strip()
    parts = value.split(".")
    if len(parts) != 3 or parts[0] != "0" or parts[1] != "0" or not parts[2].isdigit():
        raise ValueError("hedera_account_id must look like 0.0.123456")
    return value


@dataclass
class HostRecord:
    host_id: str
    role: str  # mother | contributor
    model: str
    block_indices: str
    layers_hosted: int
    public_ip: Optional[str]
    shard_manager_url: str
    peer_multiaddr: Optional[str] = None
    status: str = "pending"  # pending | online | offline
    joined_at: int = field(default_factory=lambda: int(time.time()))
    last_heartbeat: int = field(default_factory=lambda: int(time.time()))
    pending_range: Optional[str] = None
    donor_host_id: Optional[str] = None
    donor_shrink_to: Optional[str] = None
    hedera_account_id: Optional[str] = None


class SwarmRegistry:
    def __init__(
        self,
        model: str,
        total_layers: int,
        mother_shard_manager_url: str,
        mother_hedera_account_id: Optional[str] = None,
    ) -> None:
        self.model = model
        self.total_layers = total_layers
        self._lock = threading.RLock()
        self.hosts: Dict[str, HostRecord] = {}
        self.bootstrap_peers: List[str] = []
        mother_id = "mother"
        mother_wallet = None
        if mother_hedera_account_id:
            mother_wallet = validate_hedera_account_id(mother_hedera_account_id)
        self.hosts[mother_id] = HostRecord(
            host_id=mother_id,
            role="mother",
            model=model,
            block_indices=format_range(0, total_layers),
            layers_hosted=total_layers,
            public_ip=None,
            shard_manager_url=mother_shard_manager_url.rstrip("/"),
            status="online",
            hedera_account_id=mother_wallet,
        )

    def set_bootstrap_peers(self, peers: List[str]) -> None:
        with self._lock:
            self.bootstrap_peers = list(peers)

    def list_hosts(self) -> List[HostRecord]:
        with self._lock:
            return list(self.hosts.values())

    def online_payout_hosts(self) -> List[HostRecord]:
        """Online hosts that have a Hedera payout wallet and at least one layer."""
        with self._lock:
            return [
                h
                for h in self.hosts.values()
                if h.status == "online" and h.hedera_account_id and h.layers_hosted > 0
            ]

    def max_carveable(self) -> int:
        donor = self._largest_donor_locked()
        if not donor:
            return 0
        start, end = parse_range(donor.block_indices)
        return max(0, (end - start) - 1)

    def _largest_donor_locked(self) -> Optional[HostRecord]:
        online = [h for h in self.hosts.values() if h.status == "online"]
        if not online:
            return None
        return max(online, key=lambda h: h.layers_hosted)

    def join(
        self,
        *,
        layers: int,
        public_ip: str,
        shard_manager_url: str,
        hedera_account_id: str,
    ) -> dict:
        with self._lock:
            if layers < 1:
                raise ValueError("layers must be >= 1")
            if layers >= self.total_layers:
                raise ValueError(f"layers must be <= {self.total_layers - 1}")
            wallet = validate_hedera_account_id(hedera_account_id)

            donor = self._largest_donor_locked()
            if not donor:
                raise RuntimeError("No online donor available")

            d_start, d_end = parse_range(donor.block_indices)
            donor_len = d_end - d_start
            max_take = donor_len - 1
            if layers > max_take:
                raise ValueError(
                    f"Requested {layers} layers but max available from largest donor is {max_take}"
                )

            # Carve from high end of donor
            join_start = d_end - layers
            join_end = d_end
            shrink_to = format_range(d_start, join_start)
            assigned = format_range(join_start, join_end)

            host_id = f"host-{uuid.uuid4().hex[:12]}"
            record = HostRecord(
                host_id=host_id,
                role="contributor",
                model=self.model,
                block_indices=assigned,  # intended; becomes official after ready
                layers_hosted=layers,
                public_ip=public_ip,
                shard_manager_url=shard_manager_url.rstrip("/"),
                status="pending",
                pending_range=assigned,
                donor_host_id=donor.host_id,
                donor_shrink_to=shrink_to,
                hedera_account_id=wallet,
            )
            self.hosts[host_id] = record

            return {
                "host_id": host_id,
                "model": self.model,
                "block_indices": assigned,
                "layers_hosted": layers,
                "initial_peers": list(self.bootstrap_peers),
                "donor_host_id": donor.host_id,
                "max_layers_available": max_take,
                "total_layers": self.total_layers,
                "hedera_account_id": wallet,
            }

    def mark_ready(self, host_id: str, peer_multiaddr: Optional[str] = None) -> HostRecord:
        with self._lock:
            host = self.hosts.get(host_id)
            if not host:
                raise KeyError(f"Unknown host_id {host_id}")
            if host.status == "online":
                return host

            donor_id = host.donor_host_id
            shrink_to = host.donor_shrink_to
            donor = self.hosts.get(donor_id) if donor_id else None
            if not donor or not shrink_to:
                raise RuntimeError("Join record missing donor shrink plan")

            # Shrink donor via its shard manager (outside lock briefly)
            donor_url = donor.shard_manager_url
            assigned = host.pending_range or host.block_indices
            reload_peers = [peer_multiaddr] if peer_multiaddr else list(self.bootstrap_peers)

        self._reload_shard_manager(donor_url, shrink_to, initial_peers=reload_peers or None)

        with self._lock:
            host = self.hosts[host_id]
            donor = self.hosts[donor_id]
            d_start, d_end = parse_range(shrink_to)
            donor.block_indices = shrink_to
            donor.layers_hosted = d_end - d_start
            host.block_indices = assigned
            host.layers_hosted = parse_range(assigned)[1] - parse_range(assigned)[0]
            host.status = "online"
            host.last_heartbeat = int(time.time())
            if peer_multiaddr:
                host.peer_multiaddr = peer_multiaddr
            host.pending_range = None
            host.donor_shrink_to = None
            return host

    def heartbeat(self, host_id: str) -> HostRecord:
        with self._lock:
            host = self.hosts.get(host_id)
            if not host:
                raise KeyError(host_id)
            host.last_heartbeat = int(time.time())
            if host.status == "offline":
                host.status = "online"
            return host

    def leave(self, host_id: str) -> None:
        with self._lock:
            host = self.hosts.get(host_id)
            if not host:
                raise KeyError(host_id)
            if host.role == "mother":
                raise ValueError("Cannot leave as mother via this API")
            range_to_reclaim = host.block_indices if host.status in ("online", "pending") else None
            del self.hosts[host_id]

        if range_to_reclaim:
            self._reclaim_range(range_to_reclaim)

    def reap_stale(self, ttl_seconds: int = 180) -> List[str]:
        now = int(time.time())
        reclaimed: List[str] = []
        with self._lock:
            stale = [
                h
                for h in self.hosts.values()
                if h.role != "mother" and h.status == "online" and now - h.last_heartbeat > ttl_seconds
            ]
        for host in stale:
            try:
                logger.warning("Reaping stale host %s", host.host_id)
                self.leave(host.host_id)
                reclaimed.append(host.host_id)
            except Exception:  # noqa: BLE001
                logger.exception("Failed to reclaim %s", host.host_id)
        return reclaimed

    def _reclaim_range(self, block_indices: str) -> None:
        """Give reclaimed range back to the largest online donor (extend high end if contiguous)."""
        with self._lock:
            donor = self._largest_donor_locked()
            if not donor:
                logger.error("No donor to reclaim range %s", block_indices)
                return
            r_start, r_end = parse_range(block_indices)
            d_start, d_end = parse_range(donor.block_indices)
            # Prefer extending donor if ranges touch
            if d_end == r_start:
                new_range = format_range(d_start, r_end)
            elif r_end == d_start:
                new_range = format_range(r_start, d_end)
            else:
                # Non-contiguous: assign full span covering both (may overlap gaps — keep simple:
                # expand donor to min start max end only if no other hosts occupy middle.
                occupied = []
                for h in self.hosts.values():
                    if h.host_id == donor.host_id or h.status != "online":
                        continue
                    occupied.append(parse_range(h.block_indices))
                new_start, new_end = min(d_start, r_start), max(d_end, r_end)
                conflict = any(not (new_end <= a or new_start >= b) for a, b in occupied)
                if conflict:
                    logger.error(
                        "Cannot safely reclaim %s onto donor %s (non-contiguous)",
                        block_indices,
                        donor.host_id,
                    )
                    return
                new_range = format_range(new_start, new_end)

            donor_url = donor.shard_manager_url
            donor_id = donor.host_id

        self._reload_shard_manager(donor_url, new_range)
        with self._lock:
            donor = self.hosts[donor_id]
            s, e = parse_range(new_range)
            donor.block_indices = new_range
            donor.layers_hosted = e - s

    @staticmethod
    def _reload_shard_manager(
        base_url: str,
        block_indices: str,
        initial_peers: Optional[List[str]] = None,
    ) -> None:
        url = f"{base_url.rstrip('/')}/reload"
        payload: dict = {"block_indices": block_indices}
        if initial_peers:
            payload["initial_peers"] = initial_peers
        logger.info("Calling shard manager reload %s -> %s peers=%s", url, block_indices, initial_peers)
        try:
            with httpx.Client(timeout=120.0) as client:
                resp = client.post(url, json=payload)
                resp.raise_for_status()
        except Exception:  # noqa: BLE001
            logger.exception("Shard manager reload failed for %s", url)
            raise


_registry: Optional[SwarmRegistry] = None


def init_registry(
    model: str,
    total_layers: int,
    mother_shard_manager_url: str,
    mother_hedera_account_id: Optional[str] = None,
) -> SwarmRegistry:
    global _registry
    _registry = SwarmRegistry(
        model,
        total_layers,
        mother_shard_manager_url,
        mother_hedera_account_id=mother_hedera_account_id,
    )
    return _registry


def get_registry() -> SwarmRegistry:
    if _registry is None:
        raise RuntimeError("Swarm registry not initialized")
    return _registry

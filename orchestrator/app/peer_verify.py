"""Fast contributor reachability checks before blocking DHT handoff."""

from __future__ import annotations

import logging
import re
import socket
from typing import Optional
from urllib.parse import urlparse

import httpx

from orchestrator.app.registry import parse_range

logger = logging.getLogger(__name__)

_PRIVATE_HOST_RE = re.compile(
    r"^(127\.|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)"
)


def _is_public_http_url(url: str) -> bool:
    host = urlparse(url).hostname or ""
    if not host or host in ("localhost", "127.0.0.1"):
        return False
    return _PRIVATE_HOST_RE.match(host) is None


def verify_contributor_http(
    shard_manager_url: str,
    block_indices: str,
    *,
    timeout_seconds: float = 15.0,
) -> bool:
    """Return True when the contributor shard manager reports the expected blocks."""
    if not shard_manager_url or not _is_public_http_url(shard_manager_url):
        logger.info(
            "Skipping HTTP contributor verify for non-public URL %s",
            shard_manager_url,
        )
        return False
    start, end = parse_range(block_indices)
    with httpx.Client(timeout=timeout_seconds) as client:
        resp = client.get(f"{shard_manager_url.rstrip('/')}/status")
        resp.raise_for_status()
        data = resp.json()
    if not data.get("running"):
        raise RuntimeError(f"Contributor shard manager not running: {data}")
    reported = data.get("block_indices") or ""
    if reported:
        r_start, r_end = parse_range(reported)
        if r_start != start or r_end != end:
            raise RuntimeError(
                f"Contributor blocks {reported} do not match assignment {block_indices}"
            )
    logger.info("Contributor HTTP verify OK for %s blocks %s", shard_manager_url, block_indices)
    return True


def _parse_peer_tcp(peer_multiaddr: str) -> tuple[str, int]:
    """Extract host and port from /dns4/HOST/tcp/PORT or /ip4/IP/tcp/PORT multiaddrs."""
    parts = peer_multiaddr.strip().split("/")
    host: Optional[str] = None
    port: Optional[int] = None
    for i, part in enumerate(parts):
        if part in ("dns4", "dns6", "dnsaddr") and i + 1 < len(parts):
            host = parts[i + 1]
        elif part == "ip4" and i + 1 < len(parts):
            host = parts[i + 1]
        elif part == "ip6" and i + 1 < len(parts):
            host = parts[i + 1]
        elif part == "tcp" and i + 1 < len(parts):
            port = int(parts[i + 1])
    if not host or port is None:
        raise ValueError(f"Could not parse TCP endpoint from multiaddr: {peer_multiaddr}")
    return host, port


def verify_peer_tcp(peer_multiaddr: str, *, timeout_seconds: float = 10.0) -> bool:
    """Return True when the mother can open a TCP connection to the contributor peer."""
    if not peer_multiaddr:
        return False
    host, port = _parse_peer_tcp(peer_multiaddr)
    logger.info("Checking TCP reachability to contributor peer %s:%s", host, port)
    with socket.create_connection((host, port), timeout=timeout_seconds):
        pass
    logger.info("Contributor peer TCP reachable at %s:%s", host, port)
    return True


def contributor_precheck_passed(
    *,
    shard_manager_url: str,
    block_indices: str,
    peer_multiaddr: Optional[str],
    known_bootstrap_peers: Optional[list[str]] = None,
) -> bool:
    """
    Fast path for /ready: HTTP status from a public shard manager and/or TCP to peer.
    Rejects peer multiaddrs that are already mother bootstrap peers (false positives).
    """
    bootstrap = set(known_bootstrap_peers or [])
    if peer_multiaddr and peer_multiaddr in bootstrap:
        logger.warning(
            "Ignoring peer_multiaddr that matches mother bootstrap peer: %s",
            peer_multiaddr,
        )
        peer_multiaddr = None

    http_ok = False
    try:
        http_ok = verify_contributor_http(shard_manager_url, block_indices)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Contributor HTTP verify failed: %s", exc)
    tcp_ok = False
    if peer_multiaddr:
        try:
            tcp_ok = verify_peer_tcp(peer_multiaddr)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Contributor TCP verify failed: %s", exc)
    return http_ok or tcp_ok

"""Unit tests for ENS client verification logic."""

from __future__ import annotations

from unittest.mock import patch

from orchestrator.app.config import Settings
from orchestrator.app.ens_client import EnsServiceClient, _VERIFY_CACHE
from orchestrator.app.registry import HostRecord


def _host(**kwargs) -> HostRecord:
    base = {
        "host_id": "host-abc123def456",
        "role": "contributor",
        "model": "test/model",
        "block_indices": "12:20",
        "layers_hosted": 8,
        "public_ip": "1.2.3.4",
        "shard_manager_url": "http://x",
        "status": "online",
        "hedera_account_id": "0.0.123",
        "ens_name": "host-abc123.blitzwing.eth",
    }
    base.update(kwargs)
    return HostRecord(**base)


def test_verify_host_passes_when_records_match() -> None:
    _VERIFY_CACHE.clear()
    settings = Settings(ens_enabled=True)
    client = EnsServiceClient(settings)
    host = _host()
    with patch.object(client, "resolve", return_value={
        "hostId": host.host_id,
        "hederaAccountId": host.hedera_account_id,
        "blockIndices": host.block_indices,
    }):
        assert client.verify_host(host) is True


def test_verify_host_fails_on_mismatch() -> None:
    _VERIFY_CACHE.clear()
    settings = Settings(ens_enabled=True)
    client = EnsServiceClient(settings)
    host = _host(host_id="host-deadbeef0001", ens_name="host-deadbeef.blitzwing.eth")
    with patch.object(client, "resolve", return_value={
        "hostId": host.host_id,
        "hederaAccountId": "0.0.999",
        "blockIndices": host.block_indices,
    }):
        assert client.verify_host(host) is False


def test_verify_skipped_when_disabled() -> None:
    settings = Settings(ens_enabled=False)
    client = EnsServiceClient(settings)
    assert client.verify_host(_host()) is True

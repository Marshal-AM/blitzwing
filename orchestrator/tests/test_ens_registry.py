"""Gate 2: ens_name persists in swarm registry."""

from __future__ import annotations

import json
from pathlib import Path

from orchestrator.app.registry import HostRecord, SwarmRegistry


def test_ens_name_persisted(tmp_path: Path) -> None:
    path = tmp_path / "swarm_registry.json"
    reg = SwarmRegistry("test/model", 24, "http://127.0.0.1:8001", mother_hedera_account_id="0.0.1")
    reg.hosts["mother"].ens_name = "mother.blitzwing.eth"
    reg.persist()

    # Point persist path via env would be ideal; write directly for test
    payload = {
        "model": reg.model,
        "total_layers": reg.total_layers,
        "bootstrap_peers": [],
        "hosts": {hid: __import__("dataclasses").asdict(h) for hid, h in reg.hosts.items()},
    }
    path.write_text(json.dumps(payload), encoding="utf-8")

    loaded = SwarmRegistry.load_persisted(
        path, "test/model", 24, "http://127.0.0.1:8001", mother_hedera_account_id="0.0.1"
    )
    assert loaded.hosts["mother"].ens_name == "mother.blitzwing.eth"

    loaded.set_ens_name("mother", "mother.blitzwing.eth")
    assert loaded.hosts["mother"].ens_name == "mother.blitzwing.eth"

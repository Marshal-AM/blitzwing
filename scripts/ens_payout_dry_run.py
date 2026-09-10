#!/usr/bin/env python3
"""Gate 4: verify registry hosts against ENS without running inference."""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from orchestrator.app.config import get_settings
from orchestrator.app.ens_client import get_ens_client
from orchestrator.app.registry import SwarmRegistry, _persist_path


def main() -> int:
    os.environ.setdefault("ENS_ENABLED", "1")
    settings = get_settings()
    path = _persist_path()
    if not path.exists():
        print(f"No registry at {path}")
        return 1
    data = __import__("json").loads(path.read_text(encoding="utf-8"))
    reg = SwarmRegistry.load_persisted(
        path,
        data.get("model", settings.model_name),
        int(data.get("total_layers", settings.total_layers)),
        settings.mother_shard_manager_url,
        mother_hedera_account_id=settings.mother_account_id,
    )
    ens = get_ens_client(settings)
    if not ens.enabled:
        print("ENS_ENABLED=0 — nothing to verify")
        return 0

    ok_all = True
    print(f"{'host_id':22} {'ens_name':36} {'verify':8}")
    print("-" * 70)
    for h in reg.list_hosts():
        if h.status != "online" or not h.hedera_account_id:
            continue
        verified = ens.verify_host(h)
        ok_all = ok_all and verified
        print(f"{h.host_id:22} {(h.ens_name or '-'):36} {'PASS' if verified else 'FAIL':8}")
    return 0 if ok_all else 2


if __name__ == "__main__":
    raise SystemExit(main())

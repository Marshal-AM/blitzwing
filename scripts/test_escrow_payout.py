#!/usr/bin/env python3
"""Test escrow payout release without running inference.

Two modes:
  1) Prefer live orchestrator HTTP: POST /v1/internal/payout (same path as gateway)
  2) Fallback: load persisted registry + call HederaPayoutService directly

Usage (on GCP mother):
  cd ~/blitzwing && PYTHONPATH=. JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64 \\
    ~/venv/bin/python scripts/test_escrow_payout.py
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

try:
    from dotenv import load_dotenv

    load_dotenv(ROOT / ".env", override=True)
except ImportError:
    pass

# Ensure Settings picks up the latest .env (escrow redeploys change IDs).
from orchestrator.app.config import get_settings

get_settings.cache_clear()

ORCH = (os.getenv("ORCHESTRATOR_INTERNAL_URL") or "http://127.0.0.1:8002").rstrip("/")


def mirror_balance_tinybars(account_id: str) -> int:
    url = f"https://testnet.mirrornode.hedera.com/api/v1/accounts/{account_id}"
    with urllib.request.urlopen(url, timeout=20) as resp:
        data = json.loads(resp.read().decode())
    return int(data["balance"]["balance"])


def http_json(method: str, url: str, body: Optional[dict] = None, headers: Optional[dict] = None) -> Any:
    data = None if body is None else json.dumps(body).encode()
    hdrs = {"Content-Type": "application/json"}
    if headers:
        hdrs.update(headers)
    req = urllib.request.Request(url, data=data, headers=hdrs, method=method)
    with urllib.request.urlopen(req, timeout=180) as resp:
        raw = resp.read().decode()
        return json.loads(raw) if raw else None


def fetch_hosts() -> List[dict]:
    data = http_json("GET", f"{ORCH}/v1/hosts")
    return list(data.get("hosts") or [])


def payout_via_http(request_id: str) -> dict:
    return http_json(
        "POST",
        f"{ORCH}/v1/internal/payout",
        body={"request_id": request_id},
        headers={
            "X-Blitzwing-Paid": "1",
            "X-Blitzwing-X402-Tx-Id": "manual-payout-test",
        },
    )


def payout_via_local(request_id: str, hosts_json: List[dict]) -> dict:
    from orchestrator.app.config import get_settings
    from orchestrator.app.hedera_jvm import ensure_java_vm
    from orchestrator.app.hedera_payouts import get_payout_service
    from orchestrator.app.registry import HostRecord

    ensure_java_vm()
    settings = get_settings()
    hosts = [
        HostRecord(
            host_id=h["host_id"],
            role=h.get("role", "contributor"),
            model=h.get("model", settings.model_name),
            block_indices=h.get("block_indices", "0:0"),
            layers_hosted=int(h.get("layers_hosted") or 0),
            public_ip=h.get("public_ip"),
            shard_manager_url=h.get("shard_manager_url") or "http://127.0.0.1:8001",
            status=h.get("status", "online"),
            hedera_account_id=h.get("hedera_account_id"),
        )
        for h in hosts_json
        if h.get("status") == "online" and h.get("hedera_account_id") and int(h.get("layers_hosted") or 0) > 0
    ]
    payouts = get_payout_service(settings)
    receipt = payouts.redistribute(
        request_id=request_id,
        hosts=hosts,
        x402_tx_id="manual-payout-test",
    )
    return payouts.receipt_dict(receipt)


def main() -> int:
    settings = get_settings()
    settings_escrow = settings.escrow_contract_id or os.getenv("ESCROW_CONTRACT_ID", "")
    cpl = int(settings.cost_per_layer_tinybars)

    print(f"orchestrator={ORCH}")
    print(f"escrow={settings_escrow} cost_per_layer={cpl} tinybars")

    try:
        hosts = [h for h in fetch_hosts() if h.get("status") == "online"]
    except Exception as exc:  # noqa: BLE001
        print(f"FAIL: cannot reach orchestrator hosts API: {exc}")
        return 1

    payout_hosts = [
        h
        for h in hosts
        if h.get("hedera_account_id") and int(h.get("layers_hosted") or 0) > 0
    ]
    if not payout_hosts:
        print("FAIL: no online payout hosts")
        return 1

    print("online payout hosts:")
    planned_total = 0
    for h in payout_hosts:
        amt = int(h["layers_hosted"]) * cpl
        planned_total += amt
        print(
            f"  {h['host_id']:20} {h['hedera_account_id']} "
            f"layers={h['layers_hosted']} payout={amt} tinybars"
        )

    try:
        escrow_bal = mirror_balance_tinybars(settings_escrow)
        print(f"escrow balance before: {escrow_bal} tinybars ({escrow_bal / 1e8:.4f} HBAR)")
    except urllib.error.URLError as exc:
        print(f"WARN: could not read escrow balance: {exc}")
        escrow_bal = None

    if escrow_bal is not None and escrow_bal < planned_total:
        print(
            f"FAIL: escrow balance {escrow_bal} < planned payout {planned_total}. "
            "Need a prior x402 settle into escrow first."
        )
        return 1

    before: Dict[str, int] = {}
    for h in payout_hosts:
        acct = h["hedera_account_id"]
        try:
            before[acct] = mirror_balance_tinybars(acct)
        except urllib.error.URLError as exc:
            print(f"WARN: balance before failed for {acct}: {exc}")

    request_id = os.getenv("PAYOUT_TEST_REQUEST_ID", f"payout-test-{int(time.time())}")
    print(f"\nreleasing escrow for request_id={request_id} ...")

    try:
        out = payout_via_http(request_id)
        mode = "http"
    except Exception as http_exc:  # noqa: BLE001
        print(f"HTTP payout failed ({http_exc}); trying local SDK path...")
        try:
            out = payout_via_local(request_id, payout_hosts)
            mode = "local"
        except Exception as local_exc:  # noqa: BLE001
            print(f"FAIL: both payout paths failed\n  http={http_exc}\n  local={local_exc}")
            return 1

    print(f"mode={mode}")
    print(json.dumps(out, indent=2))

    if not out or not out.get("payout_tx_id"):
        print("FAIL: no payout_tx_id in receipt")
        return 1

    # Mirror can lag a few seconds after consensus
    time.sleep(4)
    print("\nrecipient balance deltas:")
    ok = True
    for h in payout_hosts:
        acct = h["hedera_account_id"]
        if acct not in before:
            continue
        expected = int(h["layers_hosted"]) * cpl
        try:
            after = mirror_balance_tinybars(acct)
        except urllib.error.URLError as exc:
            print(f"  {acct}: mirror error {exc}")
            ok = False
            continue
        delta = after - before[acct]
        # When mother is both operator and recipient, gas fees reduce the net delta.
        is_operator = acct == os.getenv("MOTHER_ACCOUNT_ID", "")
        min_ok = expected - (10_000_000 if is_operator else 0)  # allow ~0.1 HBAR gas
        status = "OK" if delta >= min_ok else "LOW"
        if delta < min_ok:
            ok = False
        print(
            f"  {h['host_id']:20} {acct} delta={delta:+d} tinybars "
            f"(expected >={expected}"
            f"{', allowing operator gas' if is_operator else ''}) [{status}]"
        )

    if escrow_bal is not None:
        try:
            after_escrow = mirror_balance_tinybars(settings_escrow)
            escrow_delta = after_escrow - escrow_bal
            print(
                f"\nescrow balance after: {after_escrow} tinybars "
                f"(delta {escrow_delta:+d})"
            )
            if escrow_delta > -planned_total:
                print(
                    f"FAIL: escrow did not drop by full payout "
                    f"(delta {escrow_delta}, planned -{planned_total})"
                )
                ok = False
            else:
                print("escrow deplete OK")
        except urllib.error.URLError:
            pass

    if ok:
        print("\nPAYOUT_TEST_OK")
        return 0
    print("\nPAYOUT_TEST_FAILED")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())

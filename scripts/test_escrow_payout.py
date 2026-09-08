#!/usr/bin/env python3
"""Test escrow payout release without running inference.

Reads online hosts from the swarm registry and calls escrow release.
Verifies recipient balances increased on Hedera testnet mirror node.

Usage (on GCP mother):
  cd ~/blitzwing && PYTHONPATH=. ~/venv/bin/python scripts/test_escrow_payout.py

Optional env:
  PAYOUT_TEST_REQUEST_ID  override request id (default: payout-test-<unix>)
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from orchestrator.app.config import get_settings
from orchestrator.app.hedera_jvm import ensure_java_vm
from orchestrator.app.hedera_payouts import get_payout_service
from orchestrator.app.registry import get_registry


def mirror_balance_tinybars(account_id: str) -> int:
    url = f"https://testnet.mirrornode.hedera.com/api/v1/accounts/{account_id}"
    with urllib.request.urlopen(url, timeout=20) as resp:
        data = json.loads(resp.read().decode())
    return int(data["balance"]["balance"])


def main() -> int:
    ensure_java_vm()
    settings = get_settings()
    registry = get_registry()
    hosts = registry.online_payout_hosts()

    if not hosts:
        print("FAIL: no online payout hosts in registry")
        return 1

    escrow = settings.escrow_contract_id
    cpl = settings.cost_per_layer_tinybars
    print(f"escrow={escrow} cost_per_layer={cpl} tinybars")
    print("online payout hosts:")
    planned_total = 0
    for h in hosts:
        amt = h.layers_hosted * cpl
        planned_total += amt
        print(
            f"  {h.host_id:20} {h.hedera_account_id} "
            f"layers={h.layers_hosted} payout={amt} tinybars"
        )

    if planned_total <= 0:
        print("FAIL: planned payout total is zero")
        return 1

    try:
        escrow_bal = mirror_balance_tinybars(escrow)
        print(f"escrow balance before: {escrow_bal} tinybars ({escrow_bal / 1e8:.4f} HBAR)")
    except urllib.error.URLError as exc:
        print(f"WARN: could not read escrow balance: {exc}")
        escrow_bal = None

    before: dict[str, int] = {}
    for h in hosts:
        if not h.hedera_account_id:
            continue
        try:
            before[h.hedera_account_id] = mirror_balance_tinybars(h.hedera_account_id)
        except urllib.error.URLError as exc:
            print(f"WARN: balance before failed for {h.hedera_account_id}: {exc}")

    request_id = os.getenv("PAYOUT_TEST_REQUEST_ID", f"payout-test-{int(time.time())}")
    print(f"\nreleasing escrow for request_id={request_id} ...")

    payouts = get_payout_service(settings)
    receipt = payouts.redistribute(
        request_id=request_id,
        hosts=hosts,
        x402_tx_id="manual-payout-test",
    )
    out = payouts.receipt_dict(receipt)
    print(json.dumps(out, indent=2))

    if not out.get("payout_tx_id"):
        print("FAIL: no payout_tx_id in receipt")
        return 1

    print("\nrecipient balance deltas:")
    ok = True
    for h in hosts:
        acct = h.hedera_account_id
        if not acct or acct not in before:
            continue
        expected = h.layers_hosted * cpl
        try:
            after = mirror_balance_tinybars(acct)
        except urllib.error.URLError as exc:
            print(f"  {acct}: mirror error {exc}")
            ok = False
            continue
        delta = after - before[acct]
        status = "OK" if delta >= expected else "LOW"
        if delta < expected:
            ok = False
        print(
            f"  {h.host_id:20} {acct} delta={delta:+d} tinybars "
            f"(expected >={expected}) [{status}]"
        )

    if escrow_bal is not None:
        try:
            after_escrow = mirror_balance_tinybars(escrow)
            print(
                f"\nescrow balance after: {after_escrow} tinybars "
                f"(delta {after_escrow - escrow_bal:+d})"
            )
        except urllib.error.URLError:
            pass

    if ok:
        print("\nPAYOUT_TEST_OK")
        return 0
    print("\nPAYOUT_TEST_FAILED")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())

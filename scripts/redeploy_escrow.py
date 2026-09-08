#!/usr/bin/env python3
"""Redeploy BlitzwingEscrow with ECDSA alias as operator (fixes only-operator revert)."""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path


def log(msg: str) -> None:
    print(msg, flush=True)


# Prefer caller-provided JAVA_HOME; never force a Linux path on Windows.
if not os.environ.get("JAVA_HOME"):
    for candidate in (
        r"C:\Program Files\Java\jdk-21",
        "/usr/lib/jvm/java-21-openjdk-amd64",
        "/usr/lib/jvm/default-java",
    ):
        if Path(candidate).is_dir():
            os.environ["JAVA_HOME"] = candidate
            break

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

log(f"JAVA_HOME={os.environ.get('JAVA_HOME')}")
log("importing eth_account / hedera (JVM starts here — can take ~10-30s)...")

from eth_account import Account
from hedera import (
    AccountId,
    Client,
    ContractCreateFlow,
    ContractFunctionParameters,
    Hbar,
    PrivateKey,
    TransferTransaction,
)

from orchestrator.app.config import get_settings
from orchestrator.app.hedera_jvm import ensure_java_vm


def main() -> int:
    log("starting JVM via jnius...")
    ensure_java_vm()
    log("JVM ready")

    get_settings.cache_clear()
    settings = get_settings()
    raw = settings.mother_private_key
    if not raw.startswith("0x"):
        raw = "0x" + raw
    alias = Account.from_key(raw).address
    log(f"operator alias={alias}")
    log(f"mother account={settings.mother_account_id}")

    artifact = (
        ROOT
        / "contracts"
        / "artifacts"
        / "contracts"
        / "BlitzwingEscrow.sol"
        / "BlitzwingEscrow.json"
    )
    if not artifact.exists():
        artifact = (
            ROOT
            / "contracts"
            / "artifacts"
            / "contracts"
            / "contracts"
            / "BlitzwingEscrow.sol"
            / "BlitzwingEscrow.json"
        )
    if not artifact.exists():
        log(f"FAIL: bytecode artifact missing at {artifact}")
        return 1

    data = json.loads(artifact.read_text(encoding="utf-8"))
    bytecode = data["bytecode"]
    if bytecode.startswith("0x"):
        bytecode = bytecode[2:]
    log(f"bytecode bytes={len(bytecode) // 2}")

    log("connecting Hedera testnet client...")
    client = Client.forTestnet()
    key = PrivateKey.fromStringECDSA(raw.replace("0x", ""))
    client.setOperator(AccountId.fromString(settings.mother_account_id), key)

    params = ContractFunctionParameters().addAddress(alias)
    log("submitting ContractCreateFlow (file upload + create — often 30-90s)...")
    flow = (
        ContractCreateFlow()
        .setBytecode(bytecode)
        .setGas(2_000_000)
        .setConstructorParameters(params)
    )
    resp = flow.execute(client)
    log("create submitted; waiting for receipt...")
    receipt = resp.getReceipt(client)
    contract_id = receipt.contractId
    cid = contract_id.toString() if hasattr(contract_id, "toString") else str(contract_id)
    evm = contract_id.toSolidityAddress()
    if not str(evm).startswith("0x"):
        evm = f"0x{evm}"
    log(f"NEW_ESCROW_CONTRACT_ID={cid}")
    log(f"NEW_ESCROW_EVM_ADDRESS={evm}")

    seed = 500_000_000  # 5 HBAR
    log(f"seeding escrow with {seed} tinybars...")
    seed_tx = (
        TransferTransaction()
        .addHbarTransfer(AccountId.fromString(settings.mother_account_id), Hbar.fromTinybars(-seed))
        .addHbarTransfer(AccountId.fromString(cid), Hbar.fromTinybars(seed))
    )
    seed_resp = seed_tx.execute(client)
    seed_receipt = seed_resp.getReceipt(client)
    log(
        f"seeded tx={seed_resp.transactionId.toString()} status={seed_receipt.status}"
    )

    env_path = ROOT / ".env"

    def upsert(content: str, key: str, value: str) -> str:
        pattern = re.compile(rf"^{re.escape(key)}=.*$", re.M)
        line = f"{key}={value}"
        if pattern.search(content):
            return pattern.sub(line, content)
        return content.rstrip() + "\n" + line + "\n"

    text = env_path.read_text(encoding="utf-8") if env_path.exists() else ""
    text = upsert(text, "ESCROW_CONTRACT_ID", cid)
    text = upsert(text, "ESCROW_EVM_ADDRESS", evm)
    text = upsert(text, "ESCROW_OPERATOR_PRIVATE_KEY", raw)
    env_path.write_text(text, encoding="utf-8")
    log(f"Updated {env_path}")
    log("REDEPLOY_OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

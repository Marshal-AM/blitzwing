#!/usr/bin/env python3
"""Redeploy BlitzwingEscrow with ECDSA alias as operator (fixes only-operator revert)."""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

os.environ.setdefault("JAVA_HOME", "/usr/lib/jvm/java-21-openjdk-amd64")
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from eth_account import Account
from hedera import (
    AccountId,
    Client,
    ContractCreateFlow,
    ContractFunctionParameters,
    Hbar,
    PrivateKey,
)

from orchestrator.app.config import get_settings
from orchestrator.app.hedera_jvm import ensure_java_vm


def main() -> int:
    ensure_java_vm()
    settings = get_settings()
    raw = settings.mother_private_key
    if not raw.startswith("0x"):
        raw = "0x" + raw
    alias = Account.from_key(raw).address
    print("operator alias", alias)

    artifact = ROOT / "contracts" / "artifacts" / "contracts" / "BlitzwingEscrow.sol" / "BlitzwingEscrow.json"
    if not artifact.exists():
        # hardhat may nest under contracts/contracts
        alt = ROOT / "contracts" / "artifacts" / "contracts" / "contracts" / "BlitzwingEscrow.sol" / "BlitzwingEscrow.json"
        artifact = alt if alt.exists() else artifact
    data = json.loads(artifact.read_text(encoding="utf-8"))
    bytecode = data["bytecode"]
    if bytecode.startswith("0x"):
        bytecode = bytecode[2:]

    client = Client.forTestnet()
    key = PrivateKey.fromStringECDSA(raw.replace("0x", ""))
    client.setOperator(AccountId.fromString(settings.mother_account_id), key)

    params = ContractFunctionParameters().addAddress(alias)
    flow = (
        ContractCreateFlow()
        .setBytecode(bytecode)
        .setGas(2_000_000)
        .setConstructorParameters(params)
        .setMaxTransactionFee(Hbar.fromTinybars(2_000_000_000))
    )
    resp = flow.execute(client)
    receipt = resp.getReceipt(client)
    contract_id = receipt.contractId
    cid = contract_id.toString() if hasattr(contract_id, "toString") else str(contract_id)
    # Derive EVM address from contract num
    # ContractId has toSolidityAddress
    evm = contract_id.toSolidityAddress()
    if not str(evm).startswith("0x"):
        evm = f"0x{evm}"
    print("NEW_ESCROW_CONTRACT_ID", cid)
    print("NEW_ESCROW_EVM_ADDRESS", evm)

    # Seed escrow with 5 HBAR so payout tests can run without a prior x402 settle.
    from hedera import TransferTransaction

    seed = 500_000_000  # 5 HBAR tinybars
    seed_tx = (
        TransferTransaction()
        .addHbarTransfer(AccountId.fromString(settings.mother_account_id), Hbar.fromTinybars(-seed))
        .addHbarTransfer(AccountId.fromString(cid), Hbar.fromTinybars(seed))
    )
    seed_resp = seed_tx.execute(client)
    seed_receipt = seed_resp.getReceipt(client)
    print(
        "seeded escrow",
        seed,
        "tinybars tx=",
        seed_resp.transactionId.toString(),
        "status=",
        seed_receipt.status,
    )

    env_path = ROOT / ".env"
    text = env_path.read_text(encoding="utf-8") if env_path.exists() else ""
    def upsert(content: str, key: str, value: str) -> str:
        pattern = re.compile(rf"^{re.escape(key)}=.*$", re.M)
        line = f"{key}={value}"
        if pattern.search(content):
            return pattern.sub(line, content)
        return content.rstrip() + "\n" + line + "\n"

    text = upsert(text, "ESCROW_CONTRACT_ID", cid)
    text = upsert(text, "ESCROW_EVM_ADDRESS", evm)
    text = upsert(text, "ESCROW_OPERATOR_PRIVATE_KEY", raw)
    env_path.write_text(text, encoding="utf-8")
    print("Updated", env_path)
    print("REDEPLOY_OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

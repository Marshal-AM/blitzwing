#!/usr/bin/env python3
"""Local-only escrow release smoke test (no GCP, no inference)."""
from __future__ import annotations

import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def log(msg: str) -> None:
    print(msg, flush=True)


if not os.environ.get("JAVA_HOME"):
    for c in (r"C:\Program Files\Java\jdk-21", "/usr/lib/jvm/java-21-openjdk-amd64"):
        if Path(c).is_dir():
            os.environ["JAVA_HOME"] = c
            break

log(f"JAVA_HOME={os.environ.get('JAVA_HOME')}")
log("loading .env + starting JVM...")

from dotenv import load_dotenv

load_dotenv(ROOT / ".env", override=True)

from eth_account import Account
from hedera import (
    AccountId,
    Client,
    ContractCallQuery,
    ContractExecuteTransaction,
    ContractFunctionParameters,
    ContractId,
    Hbar,
    PrivateKey,
)

from orchestrator.app.config import get_settings
from orchestrator.app.hedera_jvm import big_integers, ensure_java_vm

get_settings.cache_clear()
ensure_java_vm()
settings = get_settings()
log(f"escrow={settings.escrow_contract_id} evm={settings.escrow_evm_address}")

raw = settings.mother_private_key
if not raw.startswith("0x"):
    raw = "0x" + raw
alias = Account.from_key(raw).address
long_zero = AccountId.fromString(settings.mother_account_id).toSolidityAddress()
if not str(long_zero).startswith("0x"):
    long_zero = f"0x{long_zero}"
log(f"mother={settings.mother_account_id}")
log(f"long_zero={long_zero}")
log(f"ecdsa_alias={alias}")

client = Client.forTestnet()
key = PrivateKey.fromStringECDSA(raw.replace("0x", ""))
client.setOperator(AccountId.fromString(settings.mother_account_id), key)
cid = ContractId.fromString(settings.escrow_contract_id)

log("query operator()...")
op = (
    ContractCallQuery()
    .setContractId(cid)
    .setGas(100_000)
    .setFunction("operator")
    .setMaxQueryPayment(Hbar.fromTinybars(100_000_000))
    .execute(client)
    .getAddress(0)
)
log(f"operator()={op}")

log("query totalBalance()...")
bal = (
    ContractCallQuery()
    .setContractId(cid)
    .setGas(100_000)
    .setFunction("totalBalance")
    .setMaxQueryPayment(Hbar.fromTinybars(100_000_000))
    .execute(client)
    .getUint256(0)
)
bal_s = bal.toString() if hasattr(bal, "toString") else str(bal)
log(f"totalBalance={bal_s}")

amount = 1_000_000  # 0.01 HBAR
request_id = f"local-test-{int(time.time())}".encode()
request_id = request_id[:32].ljust(32, b"\0")

# Pay ECDSA alias (matches how Hedera maps ECDSA accounts in EVM)
recipients = [alias]
log(f"releasing {amount} tinybars to alias {alias}...")
params = ContractFunctionParameters()
params.addBytes32(request_id)
params.addAddressArray(recipients)
params.addUint256Array(big_integers([amount]))

try:
    resp = (
        ContractExecuteTransaction()
        .setContractId(cid)
        .setGas(2_000_000)
        .setFunction("release", params)
        .setMaxTransactionFee(Hbar.fromTinybars(500_000_000))
        .execute(client)
    )
    log(f"submitted {resp.transactionId.toString()}; waiting receipt...")
    receipt = resp.getReceipt(client)
    log(f"RELEASE_OK status={receipt.status}")
except Exception as exc:
    log(f"RELEASE_ALIAS_FAIL: {exc}")
    log(f"retrying release to long-zero {long_zero}...")
    params2 = ContractFunctionParameters()
    params2.addBytes32(b"\x33" * 32)
    params2.addAddressArray([long_zero])
    params2.addUint256Array(big_integers([amount]))
    try:
        resp = (
            ContractExecuteTransaction()
            .setContractId(cid)
            .setGas(2_000_000)
            .setFunction("release", params2)
            .setMaxTransactionFee(Hbar.fromTinybars(500_000_000))
            .execute(client)
        )
        log(f"submitted {resp.transactionId.toString()}; waiting receipt...")
        receipt = resp.getReceipt(client)
        log(f"RELEASE_LONGZERO_OK status={receipt.status}")
    except Exception as exc2:
        log(f"RELEASE_LONGZERO_FAIL: {exc2}")
        sys.exit(1)

log("LOCAL_ESCROW_TEST_OK")

#!/usr/bin/env python3
import json
import os
import urllib.request

os.environ.setdefault("JAVA_HOME", "/usr/lib/jvm/java-21-openjdk-amd64")

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

ensure_java_vm()
settings = get_settings()
client = Client.forTestnet()
key = PrivateKey.fromStringECDSA(settings.mother_private_key.replace("0x", ""))
client.setOperator(AccountId.fromString(settings.mother_account_id), key)
cid = ContractId.fromString(settings.escrow_contract_id)


def u256(name: str) -> str:
    q = (
        ContractCallQuery()
        .setContractId(cid)
        .setGas(100_000)
        .setFunction(name)
        .setMaxQueryPayment(Hbar.fromTinybars(100_000_000))
    )
    return str(q.execute(client).getUint256(0))


print("totalBalance", u256("totalBalance"))
print("poolBalance", u256("poolBalance"))

# contract results for failed release
tx = "0.0.9211480-1788885254-279000370"
for url in [
    f"https://testnet.mirrornode.hedera.com/api/v1/contracts/results/{tx}",
    "https://testnet.mirrornode.hedera.com/api/v1/contracts/0.0.10421334/results?order=desc&limit=3",
]:
    try:
        with urllib.request.urlopen(url, timeout=30) as resp:
            print(url, json.dumps(json.loads(resp.read().decode()), indent=2)[:3000])
    except Exception as exc:
        print(url, "ERR", exc)

# Try a tiny release of 1 tinybar to mother and see
mother = AccountId.fromString("0.0.9211480")
addr = mother.toSolidityAddress()
if not str(addr).startswith("0x"):
    addr = f"0x{addr}"
print("releasing 1 tinybar to", addr)

params = ContractFunctionParameters()
params.addBytes32(b"payout-debug-1".ljust(32, b"\0")[:32])
params.addAddressArray([addr])
params.addUint256Array(big_integers([1]))

tx = (
    ContractExecuteTransaction()
    .setContractId(cid)
    .setGas(2_000_000)
    .setFunction("release", params)
    .setMaxTransactionFee(Hbar.fromTinybars(500_000_000))
)
try:
    resp = tx.execute(client)
    receipt = resp.getReceipt(client)
    print("tiny release OK", resp.transactionId.toString(), receipt.status)
except Exception as exc:
    print("tiny release FAIL", exc)

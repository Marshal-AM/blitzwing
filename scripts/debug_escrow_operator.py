#!/usr/bin/env python3
import json
import os
import urllib.request

os.environ.setdefault("JAVA_HOME", "/usr/lib/jvm/java-21-openjdk-amd64")

from hedera import (
    AccountId,
    Client,
    ContractCallQuery,
    ContractFunctionParameters,
    ContractId,
    Hbar,
    PrivateKey,
)

from orchestrator.app.config import get_settings
from orchestrator.app.hedera_jvm import ensure_java_vm

ensure_java_vm()
settings = get_settings()

for label, acct in [
    ("mother", "0.0.9211480"),
    ("contrib", "0.0.6111101"),
]:
    addr = AccountId.fromString(acct).toSolidityAddress()
    if not str(addr).startswith("0x"):
        addr = f"0x{addr}"
    print(f"{label} {acct} -> {addr}")

client = Client.forTestnet()
key = PrivateKey.fromStringECDSA(settings.mother_private_key.replace("0x", ""))
client.setOperator(AccountId.fromString(settings.mother_account_id), key)

cid = ContractId.fromString(settings.escrow_contract_id)
# operator()
q = (
    ContractCallQuery()
    .setContractId(cid)
    .setGas(100_000)
    .setFunction("operator")
    .setMaxQueryPayment(Hbar.fromTinybars(100_000_000))
)
result = q.execute(client)
op = result.getAddress(0)
print("contract.operator() =", op)

# totalBalance()
q2 = (
    ContractCallQuery()
    .setContractId(cid)
    .setGas(100_000)
    .setFunction("totalBalance")
    .setMaxQueryPayment(Hbar.fromTinybars(100_000_000))
)
result2 = q2.execute(client)
print("contract.totalBalance() =", result2.getUint256(0))

# poolBalance()
q3 = (
    ContractCallQuery()
    .setContractId(cid)
    .setGas(100_000)
    .setFunction("poolBalance")
    .setMaxQueryPayment(Hbar.fromTinybars(100_000_000))
)
result3 = q3.execute(client)
print("contract.poolBalance() =", result3.getUint256(0))

# mother EVM from key
print("operator from key:", key.publicKey.toEvmAddress() if hasattr(key.publicKey, "toEvmAddress") else "n/a")
try:
    print("publicKey:", key.publicKey.toString())
except Exception as e:
    print("pubkey err", e)

tx = "0.0.9211480-1788885254-279000370"
url = f"https://testnet.mirrornode.hedera.com/api/v1/transactions/{tx}"
with urllib.request.urlopen(url, timeout=30) as resp:
    data = json.loads(resp.read().decode())
print("failed tx keys:", list(data.keys()) if isinstance(data, dict) else type(data))
print(json.dumps(data, indent=2)[:2500])

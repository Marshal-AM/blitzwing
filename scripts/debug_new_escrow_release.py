#!/usr/bin/env python3
import os
import sys

os.environ.setdefault("JAVA_HOME", "/usr/lib/jvm/java-21-openjdk-amd64")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Clear settings cache
from orchestrator.app import config

config.get_settings.cache_clear()

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
from eth_account import Account

from orchestrator.app.config import get_settings
from orchestrator.app.hedera_jvm import big_integers, ensure_java_vm

ensure_java_vm()
settings = get_settings()
print("settings escrow", settings.escrow_contract_id, settings.escrow_evm_address)

raw = settings.mother_private_key
if not raw.startswith("0x"):
    raw = "0x" + raw
alias = Account.from_key(raw).address
print("alias", alias)

client = Client.forTestnet()
key = PrivateKey.fromStringECDSA(raw.replace("0x", ""))
client.setOperator(AccountId.fromString(settings.mother_account_id), key)
cid = ContractId.fromString(settings.escrow_contract_id)

op = (
    ContractCallQuery()
    .setContractId(cid)
    .setGas(100_000)
    .setFunction("operator")
    .setMaxQueryPayment(Hbar.fromTinybars(100_000_000))
    .execute(client)
    .getAddress(0)
)
print("operator()", op)

bal = (
    ContractCallQuery()
    .setContractId(cid)
    .setGas(100_000)
    .setFunction("totalBalance")
    .setMaxQueryPayment(Hbar.fromTinybars(100_000_000))
    .execute(client)
    .getUint256(0)
)
print("totalBalance", bal.toString() if hasattr(bal, "toString") else bal)

mother_addr = AccountId.fromString(settings.mother_account_id).toSolidityAddress()
if not str(mother_addr).startswith("0x"):
    mother_addr = f"0x{mother_addr}"
# Also try paying the ECDSA alias address
recipients = [alias]  # pay to alias EVM account
amounts = big_integers([1_000_000])  # 0.01 HBAR

params = ContractFunctionParameters()
params.addBytes32(b"\x11" * 32)
params.addAddressArray(recipients)
params.addUint256Array(amounts)

try:
    resp = (
        ContractExecuteTransaction()
        .setContractId(cid)
        .setGas(2_000_000)
        .setFunction("release", params)
        .setMaxTransactionFee(Hbar.fromTinybars(500_000_000))
        .execute(client)
    )
    receipt = resp.getReceipt(client)
    print("RELEASE_OK", resp.transactionId.toString(), receipt.status)
except Exception as exc:
    print("RELEASE_FAIL", exc)
    # try long-zero recipient
    params2 = ContractFunctionParameters()
    params2.addBytes32(b"\x22" * 32)
    params2.addAddressArray([mother_addr])
    params2.addUint256Array(amounts)
    try:
        resp = (
            ContractExecuteTransaction()
            .setContractId(cid)
            .setGas(2_000_000)
            .setFunction("release", params2)
            .setMaxTransactionFee(Hbar.fromTinybars(500_000_000))
            .execute(client)
        )
        receipt = resp.getReceipt(client)
        print("RELEASE_LONGZERO_OK", resp.transactionId.toString(), receipt.status)
    except Exception as exc2:
        print("RELEASE_LONGZERO_FAIL", exc2)

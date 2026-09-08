#!/usr/bin/env python3
"""Derive mother ECDSA EVM alias from private key (eth_keys/web3 style)."""
import os
import sys

os.environ.setdefault("JAVA_HOME", "/usr/lib/jvm/java-21-openjdk-amd64")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from eth_account import Account
from hedera import AccountId, PrivateKey

from orchestrator.app.config import get_settings
from orchestrator.app.hedera_jvm import ensure_java_vm

ensure_java_vm()
settings = get_settings()
raw = settings.mother_private_key
if not raw.startswith("0x"):
    raw = "0x" + raw

acct = Account.from_key(raw)
alias = acct.address
long_zero = AccountId.fromString(settings.mother_account_id).toSolidityAddress()
if not str(long_zero).startswith("0x"):
    long_zero = f"0x{long_zero}"

# also try hedera SDK
key = PrivateKey.fromStringECDSA(raw.replace("0x", ""))
print("mother_account", settings.mother_account_id)
print("long_zero", long_zero)
print("ecdsa_alias_eth_account", alias)
try:
    pk = key.getPublicKey()
    print("hedera_pubkey", pk.toString() if pk else None)
    if pk is not None:
        evm = pk.toEvmAddress()
        print("hedera_alias", evm.toString() if hasattr(evm, "toString") else evm)
except Exception as exc:
    print("hedera alias err", exc)

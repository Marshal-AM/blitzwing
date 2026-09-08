#!/usr/bin/env python3
"""Print mother ECDSA alias vs long-zero and redeploy escrow if needed."""
import json
import os
import subprocess
import sys

os.environ.setdefault("JAVA_HOME", "/usr/lib/jvm/java-21-openjdk-amd64")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from hedera import AccountId, PrivateKey
from orchestrator.app.config import get_settings
from orchestrator.app.hedera_jvm import ensure_java_vm

ensure_java_vm()
settings = get_settings()
key = PrivateKey.fromStringECDSA(settings.mother_private_key.replace("0x", ""))
long_zero = AccountId.fromString(settings.mother_account_id).toSolidityAddress()
if not str(long_zero).startswith("0x"):
    long_zero = f"0x{long_zero}"
alias = key.publicKey.toEvmAddress().toString()
if not str(alias).startswith("0x"):
    alias = f"0x{alias}"
print("mother_account", settings.mother_account_id)
print("long_zero", long_zero)
print("ecdsa_alias", alias)
print("current_escrow", settings.escrow_contract_id, settings.escrow_evm_address)

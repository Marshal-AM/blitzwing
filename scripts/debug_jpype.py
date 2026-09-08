#!/usr/bin/env python3
"""Verify hedera + jnius BigInteger path used by escrow release."""
import os
import sys

os.environ.setdefault("JAVA_HOME", "/usr/lib/jvm/java-21-openjdk-amd64")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from orchestrator.app.hedera_jvm import big_integers, ensure_java_vm

ensure_java_vm()
vals = big_integers([100, 200, 300])
print("BigInteger OK:", [str(v) for v in vals])

from hedera import (
    AccountId,
    Client,
    ContractFunctionParameters,
    ContractId,
)

params = ContractFunctionParameters()
params.addBytes32(b"\x00" * 32)
params.addAddressArray(
    [f"0x{AccountId.fromString('0.0.9211480').toSolidityAddress()}"]
)
params.addUint256Array(vals)
print("ContractFunctionParameters OK")
print("ALL_OK")

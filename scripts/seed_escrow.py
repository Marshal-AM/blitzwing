#!/usr/bin/env python3
"""Seed escrow contract with HBAR from mother (for payout tests)."""
from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv

load_dotenv(ROOT / ".env", override=True)
os.environ.setdefault("JAVA_HOME", "/usr/lib/jvm/java-21-openjdk-amd64")

from hedera import AccountId, Client, Hbar, PrivateKey, TransferTransaction

from orchestrator.app.hedera_jvm import ensure_java_vm

ensure_java_vm()
client = Client.forTestnet()
key = PrivateKey.fromStringECDSA(os.environ["MOTHER_PRIVATE_KEY"].replace("0x", ""))
mother = AccountId.fromString(os.environ["MOTHER_ACCOUNT_ID"])
escrow = AccountId.fromString(os.environ["ESCROW_CONTRACT_ID"])
client.setOperator(mother, key)
amt = int(os.getenv("SEED_TINYBARS", "500000000"))
tx = (
    TransferTransaction()
    .addHbarTransfer(mother, Hbar.fromTinybars(-amt))
    .addHbarTransfer(escrow, Hbar.fromTinybars(amt))
)
resp = tx.execute(client)
print(resp.transactionId.toString(), resp.getReceipt(client).status, flush=True)
print("SEEDED_OK", amt, flush=True)

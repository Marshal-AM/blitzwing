#!/usr/bin/env python3
import json
import os
import urllib.request

os.environ.setdefault("JAVA_HOME", "/usr/lib/jvm/java-21-openjdk-amd64")

from hedera import AccountId

for label, acct in [
    ("mother", "0.0.9211480"),
    ("contrib", "0.0.6111101"),
    ("payer", "0.0.6111100"),
]:
    addr = AccountId.fromString(acct).toSolidityAddress()
    if not str(addr).startswith("0x"):
        addr = f"0x{addr}"
    print(f"{label} {acct} -> {addr}")

# operator() selector = 0xb3ab15fb
payload = {
    "jsonrpc": "2.0",
    "method": "eth_call",
    "params": [
        {
            "to": "0x918D64946855335938072810E800F28d0957a06c",
            "data": "0xb3ab15fb",
        },
        "latest",
    ],
    "id": 1,
}
req = urllib.request.Request(
    "https://testnet.hashio.io/api",
    data=json.dumps(payload).encode(),
    headers={"content-type": "application/json"},
)
with urllib.request.urlopen(req, timeout=30) as resp:
    out = json.loads(resp.read().decode())
print("operator eth_call:", out)

# totalBalance() selector — keccak('totalBalance()')[:4]
# python can compute
try:
    from eth_hash.auto import keccak

    sel = "0x" + keccak(b"totalBalance()")[:4].hex()
    print("totalBalance selector", sel)
    payload["params"][0]["data"] = sel
    payload["id"] = 2
    req = urllib.request.Request(
        "https://testnet.hashio.io/api",
        data=json.dumps(payload).encode(),
        headers={"content-type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        print("totalBalance:", json.loads(resp.read().decode()))
except Exception as exc:
    print("totalBalance skip", exc)

# balance of contract
payload = {
    "jsonrpc": "2.0",
    "method": "eth_getBalance",
    "params": ["0x918D64946855335938072810E800F28d0957a06c", "latest"],
    "id": 3,
}
req = urllib.request.Request(
    "https://testnet.hashio.io/api",
    data=json.dumps(payload).encode(),
    headers={"content-type": "application/json"},
)
with urllib.request.urlopen(req, timeout=30) as resp:
    print("eth_getBalance:", json.loads(resp.read().decode()))

# Check failed tx
tx = "0.0.9211480-1788885254-279000370"
url = f"https://testnet.mirrornode.hedera.com/api/v1/transactions/{tx}"
with urllib.request.urlopen(url, timeout=30) as resp:
    print("failed tx:", json.dumps(json.loads(resp.read().decode()), indent=2)[:2000])

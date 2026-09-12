#!/usr/bin/env bash
# Provision ENS names for all online hosts via ens-service.
set -euo pipefail

ENS_URL="${ENS_SERVICE_URL:-http://127.0.0.1:8792}"
GATEWAY_URL="${GATEWAY_URL:-http://127.0.0.1:8000}"

echo "==> ENS health"
curl -sf "${ENS_URL}/health" | python3 -m json.tool

echo "==> current hosts"
HOSTS_JSON="$(curl -sf "${GATEWAY_URL}/v1/hosts")"
echo "${HOSTS_JSON}" | python3 -m json.tool

export ENS_URL HOSTS_JSON
python3 <<'PY'
import json, os, urllib.request

ens_url = os.environ["ENS_URL"]
hosts = json.loads(os.environ["HOSTS_JSON"])["hosts"]

for h in hosts:
    payload = {
        "hostId": h["host_id"],
        "role": h["role"],
        "hederaAccountId": h.get("hedera_account_id"),
        "blockIndices": h["block_indices"],
        "layersHosted": h["layers_hosted"],
        "model": h["model"],
        "status": h["status"],
    }
    req = urllib.request.Request(
        f"{ens_url}/v1/hosts/provision",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            out = json.loads(resp.read())
            print(f"OK  {h['host_id']} -> {out.get('ensName', out)}")
    except Exception as e:
        print(f"FAIL {h['host_id']}: {e}")
PY

echo "==> hosts after ENS provision"
curl -sf "${GATEWAY_URL}/v1/hosts" | python3 -m json.tool
echo "GCP_ENS_PROVISION_DONE"

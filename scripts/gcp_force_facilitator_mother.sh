#!/usr/bin/env bash
set -euo pipefail
ROOT="${HOME}/blitzwing"
cd "$ROOT"

# Show which account ids are set (no private keys)
python3 - <<'PY'
from pathlib import Path
env = {}
for line in Path("/home/MSI/blitzwing/.env").read_text().splitlines():
    line=line.strip()
    if not line or line.startswith("#") or "=" not in line: continue
    k,v=line.split("=",1)
    env[k]=v.strip().strip('"').strip("'")
for k in ["HEDERA_ACCOUNT_ID","MOTHER_ACCOUNT_ID","FACILITATOR_ACCOUNT_ID","FACILITATOR_PORT"]:
    print(f"{k}={env.get(k,'<missing>')}")
print("MOTHER_PRIVATE_KEY_set", bool(env.get("MOTHER_PRIVATE_KEY")))
print("FACILITATOR_PRIVATE_KEY_set", bool(env.get("FACILITATOR_PRIVATE_KEY")))
print("keys_same", env.get("FACILITATOR_PRIVATE_KEY")==env.get("MOTHER_PRIVATE_KEY"))
print("fac_is_mother_acct", env.get("FACILITATOR_ACCOUNT_ID")==env.get("MOTHER_ACCOUNT_ID"))
PY

pkill -9 -f 'packages/x402-facilitator/index.ts' || true
pkill -9 -f 'x402-facilitator/index.ts' || true
sleep 2
pgrep -af 'facilitator|x402-gateway' || echo 'check procs'

# Force rewrite facilitator identity from mother
python3 - <<'PY'
from pathlib import Path
p=Path("/home/MSI/blitzwing/.env")
lines=p.read_text().splitlines()
env={}
for line in lines:
    if not line.strip() or line.strip().startswith("#") or "=" not in line: continue
    k,v=line.split("=",1); env[k]=v
mother_id=env.get("MOTHER_ACCOUNT_ID","").strip().strip('"')
mother_key=env.get("MOTHER_PRIVATE_KEY","").strip().strip('"')
assert mother_id.startswith("0.0."), mother_id
assert mother_key, "missing MOTHER_PRIVATE_KEY"
out=[]
seen=set()
for line in lines:
    if line.startswith("FACILITATOR_ACCOUNT_ID="):
        out.append(f"FACILITATOR_ACCOUNT_ID={mother_id}"); seen.add("FACILITATOR_ACCOUNT_ID"); continue
    if line.startswith("FACILITATOR_PRIVATE_KEY="):
        out.append(f"FACILITATOR_PRIVATE_KEY={mother_key}"); seen.add("FACILITATOR_PRIVATE_KEY"); continue
    out.append(line)
if "FACILITATOR_ACCOUNT_ID" not in seen: out.append(f"FACILITATOR_ACCOUNT_ID={mother_id}")
if "FACILITATOR_PRIVATE_KEY" not in seen: out.append(f"FACILITATOR_PRIVATE_KEY={mother_key}")
p.write_text("\n".join(out)+"\n")
print("rewrote facilitator to", mother_id)
PY

set -a
# shellcheck disable=SC1091
source "$ROOT/.env"
set +a
cd "$ROOT/packages/x402-facilitator"
nohup npx tsx index.ts > "${HOME}/blitzwing-logs/facilitator.log" 2>&1 &
sleep 3
curl -sS http://127.0.0.1:8791/health; echo
curl -sS http://127.0.0.1:8791/supported; echo
tail -n 5 "${HOME}/blitzwing-logs/facilitator.log"

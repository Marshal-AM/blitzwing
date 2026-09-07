#!/usr/bin/env bash
set -euo pipefail
cd /mnt/c/Users/MSI/Desktop/blitzwing
python3 -m venv ~/.blitzwing-venv
# shellcheck disable=SC1090
source ~/.blitzwing-venv/bin/activate
pip install -U pip
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install -e ./petals
pip install -r orchestrator/requirements.txt
pip install -r shard_manager/requirements.txt
pip install -r discovery_service/requirements.txt
python - <<'PY'
import petals, fastapi, httpx
print("deps ok", petals.__version__)
PY

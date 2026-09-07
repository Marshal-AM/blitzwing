# Full local 2-node test: WSL mother + WSL contributor (Petals cannot run on native Windows).
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot

Write-Host "== kill stale contributor ports in WSL =="
wsl bash -lc "fuser -k 8011/tcp 31338/tcp 2>/dev/null || true; pkill -f 'uvicorn shard_manager.app:app --host 0.0.0.0 --port 8011' 2>/dev/null || true"

Write-Host "== restart WSL mother stack =="
wsl bash /mnt/c/Users/MSI/Desktop/blitzwing/scripts/restart_local_mother.sh

Write-Host "== tail WSL logs (background) =="
$tailJob = Start-Job -ScriptBlock {
  wsl bash -lc 'tail -n 0 -F ~/.blitzwing/contrib_shard.out ~/.blitzwing/shard_manager.out ~/.blitzwing/orchestrator.out 2>/dev/null' |
    ForEach-Object { Write-Host "[wsl] $_" }
}

Write-Host "== join WSL contributor (node 2) =="
wsl bash -lc "sed -i 's/\r$//' /mnt/c/Users/MSI/Desktop/blitzwing/scripts/local_wsl_contributor_join.sh"
wsl bash /mnt/c/Users/MSI/Desktop/blitzwing/scripts/local_wsl_contributor_join.sh
if ($LASTEXITCODE -ne 0) {
  Stop-Job $tailJob -ErrorAction SilentlyContinue
  Remove-Job $tailJob -Force -ErrorAction SilentlyContinue
  throw "Contributor join failed"
}

Write-Host "== swarm hosts =="
Invoke-RestMethod "http://127.0.0.1:8000/v1/hosts" | ConvertTo-Json -Depth 5

Write-Host "== chat test (2-node distributed inference) =="
$env:BLITZWING_BASE_URL = "http://127.0.0.1:8000/v1"
python -u (Join-Path $Root "examples\chat_client.py") -q "Say hello in one short friendly sentence." --max-tokens 32

Stop-Job $tailJob -ErrorAction SilentlyContinue
Remove-Job $tailJob -Force -ErrorAction SilentlyContinue
Write-Host "== E2E_OK =="

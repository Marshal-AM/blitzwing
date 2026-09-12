#!/usr/bin/env bash
# Disk audit + reclaim stale caches/logs on a Blitzwing VM.
set -euo pipefail

echo "=== $(hostname) disk audit ==="
df -h /
du -sh ~/.cache/petals ~/.cache/huggingface ~/blitzwing-logs ~/.blitzwing ~/parallax 2>/dev/null || true

echo "=== delete BLOOM caches ==="
rm -rf ~/.cache/petals/models--bigscience--bloom-560m
rm -rf ~/.cache/petals/models--bigscience--bloom-petals
rm -rf ~/.cache/huggingface/hub/models--bigscience--bloom-560m
rm -rf ~/.cache/huggingface/hub/models--bigscience--bloom-petals
rm -rf ~/.cache/petals/models--TinyLlama--TinyLlama-1.1B-Chat-v1.0 2>/dev/null || true

echo "=== rotate old logs ==="
find ~/blitzwing-logs -name '*.log' -mtime +7 -delete 2>/dev/null || true
find ~/blitzwing-logs -name '*.out' -mtime +7 -delete 2>/dev/null || true

if [[ -d "${HOME}/parallax" ]] && [[ ! -f "${HOME}/parallax/.keep" ]]; then
  echo "=== parallax dir present ($(du -sh ~/parallax 2>/dev/null | cut -f1)) — remove manually if unused ==="
fi

echo "=== after cleanup ==="
df -h /
du -sh ~/.cache/petals ~/.cache/huggingface ~/blitzwing-logs 2>/dev/null || true
echo "DISK_CLEANUP_OK"

#!/usr/bin/env bash
# Open all Blitzwing ports on GCP — no target-tag restrictions.
set -euo pipefail

INSTANCE="${BLITZWING_INSTANCE:-instance-20260908-053033}"
ZONE="${BLITZWING_ZONE:-us-central1-a}"
PROJECT="${BLITZWING_PROJECT:-$(gcloud config get-value project 2>/dev/null)}"

echo "=== Tagging instance ${INSTANCE} ==="
gcloud compute instances add-tags "${INSTANCE}" \
  --zone="${ZONE}" \
  --tags=blitzwing-mother,blitzwing-petals,http-server,https-server

echo "=== Updating blitzwing-ports (all Blitzwing TCP ports, no target tags) ==="
if gcloud compute firewall-rules describe blitzwing-ports >/dev/null 2>&1; then
  gcloud compute firewall-rules update blitzwing-ports \
    --allow=tcp:8000-8002,tcp:8791,tcp:9000,tcp:31337-31340 \
    --source-ranges=0.0.0.0/0 \
    --description="Blitzwing: gateway, shard, orchestrator, facilitator, discovery, petals"
else
  gcloud compute firewall-rules create blitzwing-ports \
    --allow=tcp:8000-8002,tcp:8791,tcp:9000,tcp:31337-31340 \
    --source-ranges=0.0.0.0/0 \
    --description="Blitzwing: gateway, shard, orchestrator, facilitator, discovery, petals"
fi

echo "=== Ensuring allow-all exists (catch-all, lowest priority) ==="
if ! gcloud compute firewall-rules describe allow-all >/dev/null 2>&1; then
  gcloud compute firewall-rules create allow-all \
    --allow=all \
    --source-ranges=0.0.0.0/0 \
    --priority=65534 \
    --description="Allow all ingress (Blitzwing dev)"
fi

echo "=== Current rules ==="
gcloud compute firewall-rules list --filter="name~blitzwing OR name=allow-all" \
  --format="table(name,allowed,sourceRanges,targetTags)"

echo "FIREWALL_OK"

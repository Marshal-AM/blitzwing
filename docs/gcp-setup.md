# Blitzwing GCP + network setup

This guide covers the current architecture:

1. **Discovery Service** â€” updatable registry of `model â†’ mother_url`
2. **Mother VM** â€” loads all TinyLlama layers, orchestrator + shard manager, registers with Discovery
3. **Contributors** â€” `npm i -g blitzwing && blitzwing` (interactive wizard)
4. **Consumers** â€” `examples/chat_client.py` against the motherâ€™s `/v1/chat/completions`

Default model: `TinyLlama/TinyLlama-1.1B-Chat-v1.0` (22 layers), CPU-friendly.

---

## 1. Deploy Discovery Service (once)

Use a small always-on VM or Cloud Run. Example on a micro VM:

```bash
sudo apt update && sudo apt install -y python3-pip python3-venv
# copy discovery_service/ + scripts/run_discovery.sh onto the box
python3 -m venv ~/venv && source ~/venv/bin/activate
pip install -r discovery_service/requirements.txt

export DISCOVERY_ADMIN_TOKEN='choose-a-long-secret'
export DISCOVERY_PORT=9000
# from repo root:
./scripts/run_discovery.sh
```

Open firewall TCP `9000` (or put it behind HTTPS). Note:

```text
DISCOVERY_URL=http://DISCOVERY_IP:9000
```

Bake this URL into `blitzwing` at publish time (or set `BLITZWING_DISCOVERY_URL` for staging).

### Edit a mother URL later (no CLI republish)

```bash
export DISCOVERY_URL=http://DISCOVERY_IP:9000
export DISCOVERY_ADMIN_TOKEN=...
./scripts/discovery_admin.sh update TinyLlama/TinyLlama-1.1B-Chat-v1.0 http://NEW_MOTHER_IP:8000
```

Or:

```bash
curl -X PUT "$DISCOVERY_URL/v1/mothers/TinyLlama%2FTinyLlama-1.1B-Chat-v1.0" \
  -H "Authorization: Bearer $DISCOVERY_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"mother_url":"http://NEW_IP:8000"}'
```

---

## 2. Create mother VM (VM1)

```bash
export PROJECT_ID="$(gcloud config get-value project)"
export ZONE="us-central1-a"

gcloud compute instances create blitzwing-mother \
  --zone="${ZONE}" \
  --machine-type=e2-standard-4 \
  --image-family=ubuntu-2204-lts \
  --image-project=ubuntu-os-cloud \
  --boot-disk-size=40GB \
  --tags=blitzwing-mother,blitzwing-petals

export VM1_IP="$(gcloud compute instances describe blitzwing-mother --zone="${ZONE}" --format='get(networkInterfaces[0].accessConfigs[0].natIP)')"
```

Firewall:

```bash
gcloud compute firewall-rules create blitzwing-petals-31337 \
  --allow=tcp:31337 --target-tags=blitzwing-petals --source-ranges=0.0.0.0/0

gcloud compute firewall-rules create blitzwing-api-8000 \
  --allow=tcp:8000 --target-tags=blitzwing-mother --source-ranges=0.0.0.0/0

gcloud compute firewall-rules create blitzwing-shard-8001 \
  --allow=tcp:8001 --target-tags=blitzwing-petals --source-ranges=0.0.0.0/0
```

Copy the repo onto the VM (`petals/`, `orchestrator/`, `shard_manager/`, `scripts/`).

---

## 3. Bootstrap the mother (single script)

SSH to VM1:

```bash
export PUBLIC_IP="${VM1_IP}"
export MODEL_NAME=TinyLlama/TinyLlama-1.1B-Chat-v1.0
export TOTAL_LAYERS=22
export DISCOVERY_URL=http://DISCOVERY_IP:9000
export DISCOVERY_ADMIN_TOKEN=...

chmod +x scripts/*.sh
./scripts/bootstrap_mother.sh
```

This installs deps, starts shard-manager (Petals `0:22`), starts orchestrator `:8000`, and registers the mother with Discovery.

Contributors then only need:

```bash
npm i -g blitzwing
blitzwing
```

---

## 4. Contributor machines

Any Linux machine with Python 3.10+ and Node 18+:

```bash
npm i -g blitzwing
# optional staging override:
# export BLITZWING_DISCOVERY_URL=http://DISCOVERY_IP:9000
blitzwing
```

The wizard:

1. Loads models from Discovery (no mother URL prompt)
2. Asks how many layers to host
3. Confirms public IP
4. Installs Petals if needed, joins, heartbeats

```bash
blitzwing status
blitzwing leave
```

Open TCP `31337` and `8001` on contributor firewalls so the mother can reach their shard-manager `/reload` and Petals P2P.

---

## 5. Consumer (chat completions)

```bash
export BLITZWING_BASE_URL=http://${VM1_IP}:8000/v1
python examples/chat_client.py -q "Hello"
```

---

## Layer split reminder

- Mother starts with **all** layers `[0, 22)`.
- On join, contributor chooses **N** layers; mother carves from the **high end** of the largest donor.
- After contributor is online, donor shard-manager **reloads** narrower range.
- `layers_hosted` is stored for future x402 payout weighting.

---

## 6. Publish `blitzwing` (operator)

Unscoped package on your personal npm account (no org required).

1. After Discovery is deployed, set the default URL in [`packages/cli/package.json`](packages/cli/package.json) `config.discoveryUrl` (or tell contributors to set `BLITZWING_DISCOVERY_URL`).
2. Publish:

```bash
export NPM_TOKEN=...   # do not commit; rotate if exposed
./scripts/publish_cli.sh
```

Then contributors: `npm i -g blitzwing && blitzwing`.

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| CLI: discovery empty | Register mother; check `GET $DISCOVERY_URL/v1/mothers` |
| Join 400 max layers | Ask for fewer layers; check `GET mother/v1/hosts` |
| INITIAL_PEERS missing peer id | Read `~/blitzwing-logs/shard_manager.log`, set `INITIAL_PEERS`, restart orchestrator |
| Contributor unreachable | Firewall 31337 + 8001; correct public IP in wizard |

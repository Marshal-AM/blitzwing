# blitzwing

<!-- mod: default discovery http://34.70.57.65:9000 (0.2.7) -->

Join a Blitzwing mother swarm as a compute contributor. One command — no repo clone, no ngrok, no port forwarding.

## Install

```bash
npm i -g blitzwing
```

**Windows:** run inside **WSL** (Petals needs Linux). Install Node in WSL, then `npm i -g blitzwing`.

## Use

```bash
blitzwing
```

The wizard:

1. Discovers mothers (no mother URL to type)
2. Asks which model and how many layers
3. Asks for your **Hedera account ID** (`0.0.N`) for payouts
4. Installs Petals if needed
5. Opens a free **Cloudflare Quick Tunnel** (no account / token)
6. Joins the swarm and starts heartbeats

```bash
blitzwing status
blitzwing leave
```

## Env (optional)

```bash
export BLITZWING_DISCOVERY_URL=http://127.0.0.1:9000   # override discovery
export BLITZWING_HEDERA_ACCOUNT_ID=0.0.123456          # prefill payout account
```

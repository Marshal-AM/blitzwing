# User Stories — Decentralized Inference Network (Petals + x402 + ENS + Hedera)

Two roles can test this project: someone **contributing compute** (a shard host) and someone **consuming inference** (a calling agent or developer). Both flows are independently testable and produce on-chain proof a judge can verify without trusting our word for it.

---

## Story 1 — As a Compute Provider ("I want to earn HBAR by hosting a shard")

**Persona:** Dana has a spare gaming PC with a decent GPU sitting idle. She wants to rent it out to the network and get paid per token she helps generate.

| Step | Action | What Dana sees / gets |
|---|---|---|
| 1 | Install the shard-runner client (`git clone` + one setup script) | CLI asks which model shard range her hardware can handle (based on VRAM) |
| 2 | Create/fund a Hedera testnet account (faucet) | A Hedera account ID, e.g. `0.0.481293`, holding test HBAR |
| 3 | Run `register-host.sh` — this mints her an ENS subname on Sepolia via the Permissioned Registry | She now owns `host7.shardnet.eth` as an ERC1155 token in her wallet |
| 4 | The script writes her resolver records: `shardIndex`, `computeTier` (self-reported, later verified), and `hederaAccountId` | Her Hedera payout address is now discoverable by anyone who resolves `host7.shardnet.eth` |
| 5 | Client starts serving; stays online, keeps her ENS registration renewed as a liveness signal | If she goes offline and stops renewing, she drops out of the routing table automatically — no separate heartbeat needed |
| 6 | The orchestrator picks her host for an incoming inference request and dispatches her assigned layers | Her terminal logs show a request ID and prompt token count coming in |
| 7 | After the response is assembled, she receives an HBAR (or `SHARD` token) payout proportional to her compute contribution | Her Hedera wallet balance increases — visibly, within seconds |
| 8 | She opens **HashScan** and searches her account, or checks the HCS audit topic | She sees a consensus-timestamped log entry: `{requestId, host: host7.shardnet.eth, amount, txId}` — independent proof she was paid for that specific request |

**What this proves to a judge:** a real person with consumer hardware can join the network, get a verifiable on-chain identity, and get paid automatically with no manual invoicing — end to end, no human in the loop after step 4.

---

## Story 2 — As a Consumer ("I want inference from this decentralized brain")

**Persona:** Sam is building an AI agent and wants a cheap, OpenAI-compatible chat completion endpoint — but wants to see who actually computed the response and confirm they got paid.

| Step | Action | What Sam sees / gets |
|---|---|---|
| 1 | Fund a Hedera-compatible wallet with test HBAR/USDC | Standard testnet wallet setup |
| 2 | Send `POST /v1/chat/completions` with a prompt to the orchestrator endpoint | Gets back `402 Payment Required` with a price, per the x402 spec |
| 3 | Wallet/x402 client auto-pays via the **Blocky402** facilitator | Payment settles on Hedera; request is retried with proof-of-payment attached |
| 4 | Orchestrator resolves available shard hosts via ENS (Universal Resolver V2), dispatches the prompt across them | Behind the scenes, no action needed from Sam |
| 5 | Response comes back: completion text **plus a receipt/manifest** | The manifest lists exactly which ENS-named hosts (`host3.shardnet.eth`, `host7.shardnet.eth`, ...) computed which layers, and the Hedera transaction ID for each payout |
| 6 | Sam independently resolves one of the listed ENS names | Confirms it's a real registered subname with a real `hederaAccountId` — not a made-up identifier |
| 7 | Sam checks that transaction ID on the **Hedera Mirror Node** or HashScan | Confirms the payout actually landed on-chain, for the exact amount claimed |
| 8 | (Optional) Sam checks the HCS audit topic for the same request ID | Sees the same event independently logged at consensus time — a second, tamper-evident confirmation |

**What this proves to a judge:** the consumer isn't just trusting an API response — every claim in the receipt ("this host computed this, and was paid this") is independently checkable on two public ledgers.

---

## Why this pair of stories is the whole pitch

Story 1 shows the supply side works (idle hardware → onchain identity → automatic payment). Story 2 shows the demand side works (an agent pays once, gets inference, and can audit the entire supply chain behind it). Neither story requires trusting us — that's the point of using ENS for identity and Hedera's Mirror Node / HCS for verification instead of a private database.

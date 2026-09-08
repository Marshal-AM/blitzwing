Alright — let's go maximalist. I pulled the actual ENSv2 docs and Hedera's service list to make sure this is accurate, not just plausible-sounding. Here's every primitive in each, mapped to a real job in your system.

## ENSv2 — every primitive, given a job

| ENSv2 primitive | What it is | Its job in your project |
|---|---|---|
| **Hierarchical registries** (RootRegistry → ETHRegistry → UserRegistry per name → infinite depth) | Every name with subnames gets its own registry contract, not one flat mapping | `shardnet.eth` has a UserRegistry for `*.shardnet.eth`. A host running multiple physical GPUs can go one level deeper: `layer3.host7.shardnet.eth`, `layer9.host7.shardnet.eth` — one host, multiple shard-slots, each independently manageable |
| **Permissioned Registry** (ERC1155Singleton token per name) | Each subname is a real, single-owner, transferable token | A host's registration is a tradeable asset. If someone wants to sell their "slot" (hardware + reputation) to another operator, it's an NFT transfer, not a manual re-registration |
| **Permissioned Resolver** (one per *account*, not per name, deployed as UUPS proxy) | All names owned by the same wallet share one resolver | This is the detail everyone misses: if one person hosts `layer3.host7...` and `layer9.host7...`, updating their Hedera payout address **once** updates it everywhere. That's a concrete efficiency story for judges, not a cosmetic one |
| **Enhanced Access Control (EAC)** | Role-based permissions, up to 64 roles per resource, up to 15 holders per role | Define `ROLE_SET_PAYOUT` (host-only — they own where their money goes), `ROLE_SET_COMPUTE_TIER` (orchestrator-only — set after a verified benchmark), `ROLE_SUSPEND` (you, the admin, via `grantRootRoles`). This is your actual security model, and it's demoable: try to write another host's payout field and watch it revert |
| **Resolver-level aliasing** (`setAlias`) | A subname's records get rewritten to point at another name's records | Failover hardware: `backup-host7.shardnet.eth` aliases to `host7.shardnet.eth`'s records, so a standby machine inherits identity/payout instantly with zero duplicate registration when the primary drops |
| **Namespace aliasing** (registry-level, shares a whole subtree) | An entire namespace can point at a shared registry | If a small "GPU farm" operator wants to onboard 20 machines at once under `farm1.shardnet.eth`, alias their whole subtree to one shared registry — 20 hosts show up with one operation instead of 20 |
| **Wildcard resolution** | Subnames resolve off a parent's resolver without being individually registered on-chain | For cheap, ephemeral spot-instance hosts that come and go hourly, skip full registration — `*.burst.shardnet.eth` resolves dynamically, so you're not paying gas to register a machine that'll be gone in an hour |
| **ETH Registrar** (no grace period, immediate expiry → temporary premium) | Registrations expire exactly when they say, no soft grace window | Use expiry as a **liveness signal**: if a host stops renewing, their subname is *immediately* unresolvable and drops out of your routing table automatically — no separate heartbeat oracle needed |
| **Universal Resolver V2** | Single entrypoint for resolving any name's full record set in one call | Your orchestrator calls this once per lookup instead of manually walking registry → resolver → record for every host — much cleaner integration code, worth pointing at in the demo |
| **Contract factories / per-name isolation** | Every name with subnames gets its own independently deployed registry contract | This is why the design scales to thousands of hosts without one shared contract becoming a bottleneck or a single point of failure — genuinely relevant if your pitch is "thousands of cheap machines" |
| **Record versioning** (`clearRecords`) | Wipes all records on a name in one call, bumping a version number | When a hosting slot changes hands (old operator leaves, new one takes over the same subname), wipe stale shard/tier/payout data cleanly in one call instead of manually nulling each field |
| **Reverse resolution / Hidden Contract Accounts** | Contracts can be reverse-resolved to a name too | If you deploy an escrow contract on Hedera's EVM side (see below), reverse-resolve it to `agent.shardnet.eth` so its identity is symmetric with the hosts it pays |

That's genuinely every documented ENSv2 primitive doing real work — nothing there is decorative.

## Hedera x402 core loop (implemented)

See [x402-hedera.md](x402-hedera.md) for the working spine:

`x402 pay mother (@x402/hedera Exact) → inference → HBAR redistribute by layers → HCS audit`

Contributor Hedera wallets are collected in the CLI join wizard (`hedera_account_id`). Price is `TOTAL_LAYERS * COST_PER_LAYER_TINYBARS`.

## Hedera — every service, given a job

Hedera's own track bonus list basically **is** this checklist, so mapping these isn't a stretch — it's what they're scoring for.

| Hedera service | Its job in your project |
|---|---|
| **HBAR native transfers** | Base-case payout to shard hosts after each inference request |
| **HTS (Hedera Token Service)** | Mint a custom fungible token, `SHARD`, instead of raw HBAR — gives you a closed-loop "compute credit" economy hosts can redeem, and satisfies the track's explicit "HTS tokens or custom fee schedules" bonus |
| **HTS compliance controls** (KYC, freeze, pause) | Freeze a host's `SHARD` balance if they're caught submitting fraudulent compute claims — a real Sybil-resistance lever, not just a checkbox |
| **HCS (Hedera Consensus Service)** | Every payout gets logged as a timestamped, tamper-evident HCS message: `{requestId, hostSubname, amount, txId}`. This *is* the "verifiable payment audit trail" bonus item, and it's your best demo moment — pull up HashScan live and show the numbers matching |
| **Scheduled Transactions** | Instead of paying per-request only, schedule a recurring "uptime bonus" payout to hosts who stay online — directly the track's "recurring or streamed payments" bonus |
| **Batch transactions** | Pay all contributing hosts for one inference request atomically in a single batch — either every host gets paid or none do, no partial-payment failure state |
| **Smart Contract Service** (EVM-compatible) | Deploy a small escrow contract: x402 payment lands here first, released to hosts only after the orchestrator confirms valid shard output — protects the caller from paying for a broken response |
| **Mirror Node REST API** | Public, free verification layer — anyone (a judge, a host, another agent) can independently confirm a payout happened without trusting your orchestrator's word |
| **JSON-RPC Relay** | Lets your escrow contract be deployed/tested with standard Ethereum tooling (Hardhat/Foundry/ethers.js) instead of Hedera-specific tooling — faster to build |
| **File Service** | Store the immutable "shard manifest" for a completed request (which hosts, which layers, in what order) as a Hedera File — a permanent, chain-native record separate from the HCS log |
| **Hedera Agent Kit** | Wire your orchestrator's payment/query logic through this so it's a proper "agent" in Hedera's own framework, not a bespoke script calling the SDK directly |
| **x402 via `@x402/hedera` + official facilitator** | Payment gate on inference (`packages/x402-gateway`) — track qualification requirement |

## The one thing to be honest about

This is now a genuinely large build — ENSv2's full feature set plus essentially all of Hedera's native services plus Petals plumbing. I'd sequence it: get the **core loop working first** (x402 → inference → single ENS lookup → single HBAR payout → one HCS log entry) end-to-end and demoable, *then* layer in aliasing, wildcard hosts, HTS tokens, scheduled transactions, and batching as depth on top of a working spine. A judge who sees ten features half-wired reads as a smaller team than one who sees four features rock-solid and six more explained as "here's the architecture for it, here's why it matters" in the README. Given the breadth here, I'd genuinely suggest picking up the Claude Code app for this build — juggling two chains, several contract types, and Petals networking in one hackathon sprint is exactly the kind of multi-file, multi-system work it's built for.Want me to turn this into an actual build plan next — like a phased checklist with which contracts to write first, or a repo scaffold you can hand to Claude Code directly?
The mechanism: a "shrink and hand off" rebalance

Here's the state before anyone registers:

Blocks:   0 ─────────────── 40 ─────────────── 80
VM1 serves: [0────────40)
VM2 serves:            [40────────────80)

Full coverage, two participants, Story 2 works right now with no judge involvement.

When a judge registers as a host (or you run a script simulating it), here's what actually needs to happen — and it needs a small piece of infrastructure Petals doesn't give you out of the box:

Build a lightweight "shard manager" sidecar on each VM. This is just a small control process (REST/gRPC) sitting next to the Petals server subprocess. Its only job: start/stop/restart the Petals server with a given --block_indices range. This is the missing piece — Petals servers don't natively accept "shrink your range" commands mid-flight, but restarting a server with a narrower range is fast, because the layer weights are already cached on disk from the checkpoint download. No redownload, just a reload with new args. That's what makes this practical for a live demo instead of a slow multi-minute process.

Then the handoff sequence:

Judge's device connects, announces its capacity (say, enough for 10 blocks).
Orchestrator's block-assignment table picks a donor — say VM1, currently serving [0,40) — and computes a carve-out: VM1 will shrink to [0,30), freeing [30,40).
Orchestrator calls VM1's shard manager: "reload with range [0,30)." VM1's Petals server restarts narrower — takes seconds, not minutes, since weights are cached.
Orchestrator tells the judge's client to load and serve [30,40) from your checkpoint source. This does take real download time (this is the one step you can't avoid), so for the live demo use a small model where that's tens of seconds, not tens of minutes.
Orchestrator mints the judge's ENS subname with shardIndex = [30,40), and updates VM1's existing resolver record to reflect its new narrower range — this is a clearRecords + rewrite, and it's a great thing to show live on Etherscan/ENS app: the on-chain record for VM1 visibly changes.
New state:
Blocks:   0 ────────── 30 ── 40 ─────────────── 80
VM1 serves: [0──────30)
Judge:                 [30──40)
VM2 serves:                  [40────────────80)

Coverage is still complete throughout the whole process — Story 2 never breaks.

Proving it's real, not staged

This is the part that matters for a judge who's skeptical: after the handoff, route a follow-up inference request through the orchestrator and show, live, that:

The judge's device logs show it received and processed a request for blocks [30,40)
VM1's logs show it's no longer handling that range
The ENS records for both VM1 and the judge's subname reflect the new split, verifiable independently on Sepolia

That's a genuine before/after with on-chain proof, not a narrated claim.

Handling the judge going offline (which they will, mid-demo or after)

Use the same expiry mechanism from Story 1 you already have: if the judge's host stops renewing its ENS registration, the orchestrator detects the lapsed range and automatically reissues a "reclaim" command to VM1 — reload back to [0,40). This closes the loop cleanly and it's worth showing too: register → serve → go offline → watch VM1 silently absorb the range back within the demo video, no manual intervention.

One build note: step 3 (VM shrink) and step 6 (auto-reclaim) are the two pieces of custom glue code that don't exist in Petals already — budget real time for that sidecar, since it's small but it's the thing that makes the whole demo provable rather than just plausible.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { API_CONFIG } from "@/config";
import { fetchSwarmSnapshot, type HostPublic } from "@/lib/blitzwing-api";
import { paidChatCompletion, streamTokens } from "@/lib/x402-client";
import { hostToNodeRuntime, hostsToSwarmNodes } from "@/lib/swarm-adapter";
import { hederaExplorerTopic, hederaExplorerTx, parsePaymentReceipt, tinybarsToHbar } from "@/lib/payment";
import {
  type NodeRuntime,
  type OrchLog,
  type PaymentReceipt,
  type Phase,
  type Pulse,
  type SwarmNode,
  type Tone,
} from "./types";

const CANCELLED = Symbol("cancelled");

function emptyRuntime(node: SwarmNode): NodeRuntime {
  return {
    status: node.online ? "idle" : "offline",
    load: 0,
    hops: 0,
    lastMs: 0,
    kv: 0,
    logs: [],
  };
}

export function useSwarmSimulation() {
  const [nodes, setNodes] = useState<SwarmNode[]>([]);
  const [totalLayers, setTotalLayers] = useState(32);
  const [manifestComplete, setManifestComplete] = useState(false);
  const [motherUrl, setMotherUrl] = useState<string | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [runtime, setRuntime] = useState<Record<string, NodeRuntime>>({});
  const [orchLogs, setOrchLogs] = useState<OrchLog[]>([]);
  const [tokens, setTokens] = useState<string[]>([]);
  const [pulses, setPulses] = useState<Pulse[]>([]);
  const [activeWires, setActiveWires] = useState<string[]>([]);
  const [tokenIndex, setTokenIndex] = useState(0);
  const [totalTokens, setTotalTokens] = useState(0);
  const [prompt, setPrompt] = useState(API_CONFIG.defaultPrompt);
  const [payment, setPayment] = useState<PaymentReceipt | null>(null);

  const online = useMemo(() => nodes.filter((n) => n.online), [nodes]);

  const runIdRef = useRef(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const keyRef = useRef(0);
  const logRef = useRef(0);
  const prevNodesRef = useRef<SwarmNode[]>([]);
  const runtimeRef = useRef(runtime);
  runtimeRef.current = runtime;

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  const orch = useCallback(
    (text: string, tone: Tone = "cyan", scope = "orchestrator", href?: string | null) => {
      logRef.current += 1;
      setOrchLogs((prev) => [
        ...prev.slice(-40),
        { id: logRef.current, scope, text, tone, href },
      ]);
    },
    [],
  );

  const reset = useCallback(() => {
    runIdRef.current += 1;
    clearTimers();
    setPhase("idle");
    setOrchLogs([]);
    setTokens([]);
    setPulses([]);
    setActiveWires([]);
    setTokenIndex(0);
    setTotalTokens(0);
    setPayment(null);
    setRuntime(Object.fromEntries(nodes.map((n) => [n.id, emptyRuntime(n)])));
  }, [nodes]);

  useEffect(() => clearTimers, []);

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      try {
        const snap = await fetchSwarmSnapshot();
        if (cancelled) return;
        setMotherUrl(snap.motherUrl);
        setTotalLayers(snap.hosts.total_layers);
        setManifestComplete(snap.manifest.complete);
        setPollError(null);

        const swarmNodes = hostsToSwarmNodes(snap.hosts.hosts);
        setNodes(swarmNodes);
        setRuntime((prev) => {
          const next: Record<string, NodeRuntime> = {};
          for (const node of swarmNodes) {
            const existing = prev[node.id];
            if (existing && phase !== "idle" && phase !== "complete") {
              next[node.id] = existing;
            } else {
              next[node.id] = existing
                ? { ...existing, status: node.online ? existing.status : "offline" }
                : hostToNodeRuntime(
                    snap.hosts.hosts.find((h) => h.host_id === node.id) as HostPublic,
                  );
            }
          }
          return next;
        });
      } catch (err) {
        if (cancelled) return;
        setPollError(err instanceof Error ? err.message : String(err));
      }
    };

    poll();
    const interval = setInterval(poll, API_CONFIG.pollInterval);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [phase]);

  useEffect(() => {
    const prev = prevNodesRef.current;
    const prevOnline = new Set(prev.filter((n) => n.online).map((n) => n.id));
    const nextOnline = nodes.filter((n) => n.online);

    for (const node of nextOnline) {
      if (!prevOnline.has(node.id)) {
        const ens = node.ensName ? ` · ${node.ensName}` : "";
        orch(
          `${node.label} joined — blocks ${node.blocks[0]}:${node.blocks[1]}${ens}`,
          "lime",
          node.label,
        );
      }
    }

    for (const node of prev) {
      if (node.online && !nextOnline.some((n) => n.id === node.id)) {
        orch(`${node.label} left swarm`, "amber", "orchestrator");
      }
    }

    prevNodesRef.current = nodes;
  }, [nodes, orch]);

  const run = useCallback(async (accountId: string | null) => {
    if (!accountId) {
      orch("Connect HashPack wallet before running paid inference", "amber", "orchestrator");
      return;
    }
    if (online.length === 0) {
      orch("No online hosts available", "amber", "orchestrator");
      return;
    }
    if (!manifestComplete) {
      orch("Swarm manifest incomplete — inference may fail", "amber", "orchestrator");
    }

    runIdRef.current += 1;
    const runId = runIdRef.current;
    clearTimers();

    setOrchLogs([]);
    setTokens([]);
    setPulses([]);
    setActiveWires([]);
    setTokenIndex(0);
    setTotalTokens(0);
    setPayment(null);
    keyRef.current = 0;
    setRuntime(Object.fromEntries(nodes.map((n) => [n.id, emptyRuntime(n)])));

    const guard = () => {
      if (runIdRef.current !== runId) throw CANCELLED;
    };

    const nodeLog = (node: SwarmNode, text: string) =>
      setRuntime((prev) => {
        const cur = prev[node.id];
        if (!cur) return prev;
        return { ...prev, [node.id]: { ...cur, logs: [...cur.logs.slice(-6), text] } };
      });

    const patch = (node: SwarmNode, next: Partial<NodeRuntime>) =>
      setRuntime((prev) => {
        const cur = prev[node.id];
        if (!cur) return prev;
        return { ...prev, [node.id]: { ...cur, ...next } };
      });

    const firePulse = (wire: string, tone: Tone, duration: number) => {
      keyRef.current += 1;
      const key = `${runId}-${keyRef.current}`;
      setPulses((prev) => [...prev.slice(-60), { key, wire, tone, duration }]);
      setActiveWires((prev) => [...prev, wire]);
      timers.current.push(
        setTimeout(() => setActiveWires((prev) => prev.filter((w) => w !== wire)), duration + 60),
      );
    };

    const tail = online[online.length - 1]!;
    let tokenCount = 0;
    let expectedTokens = API_CONFIG.maxTokens;
    let animating = 0;
    const maxParallelAnimations = 2;

    const animateToken = (token: string, tokenNum: number) => {
      guard();
      const verbose = tokenNum <= 2;
      const hopDelay = verbose ? 70 : 28;

      for (let i = 0; i < online.length; i += 1) {
        const node = online[i]!;
        const next = online[i + 1];
        const layerSpan = node.blocks[1] - node.blocks[0];
        const ms = Math.round(28 + layerSpan * (tokenNum === 1 ? 4 : 1.8));
        const hopAt = i * hopDelay;

        timers.current.push(
          setTimeout(() => {
            if (runIdRef.current !== runId) return;
            patch(node, { status: "computing", load: 0.55 + Math.random() * 0.35 });
            if (verbose) {
              nodeLog(
                node,
                i === 0
                  ? `POST /v1/chain/prefix  input_ids[1,${12 + tokenNum}]`
                  : `POST /v1/chain/continue  hidden[1,${12 + tokenNum},1024]`,
              );
            } else {
              nodeLog(
                node,
                `tok#${tokenNum} rpc_forward ${node.blocks[0]}:${node.blocks[1]} · ${ms}ms`,
              );
            }
          }, hopAt),
        );

        timers.current.push(
          setTimeout(() => {
            if (runIdRef.current !== runId) return;
            const hops = (runtimeRef.current[node.id]?.hops ?? 0) + 1;
            patch(node, {
              status: "emitting",
              hops,
              lastMs: ms,
              kv: Math.min(100, Math.round((tokenNum / Math.max(expectedTokens, 1)) * 100)),
            });
            if (next) {
              firePulse(`hop-${node.index}`, node.tone, verbose ? 320 : 180);
              if (verbose) nodeLog(node, `hidden → ${next.label}`);
            }
          }, hopAt + hopDelay),
        );

        timers.current.push(
          setTimeout(() => {
            if (runIdRef.current !== runId) return;
            patch(node, { status: "idle", load: 0.16 });
          }, hopAt + hopDelay * 2),
        );
      }

      const tailAt = online.length * hopDelay;
      timers.current.push(
        setTimeout(() => {
          if (runIdRef.current !== runId) return;
          nodeLog(tail, `lm_head + sample`);
          patch(tail, { status: "emitting", load: 0.9 });
          firePulse(`collect-${tail.index}`, "lime", 240);
        }, tailAt),
      );
      timers.current.push(
        setTimeout(() => {
          if (runIdRef.current !== runId) return;
          patch(tail, { status: "idle", load: 0.2 });
          if (tokenNum === 1) orch("first token emitted · TTFT logged", "lime", tail.label);
        }, tailAt + 60),
      );
    };

    const scheduleTokenAnimation = (token: string, tokenNum: number) => {
      if (animating >= maxParallelAnimations) {
        timers.current.push(
          setTimeout(() => scheduleTokenAnimation(token, tokenNum), 40),
        );
        return;
      }
      animating += 1;
      animateToken(token, tokenNum);
      timers.current.push(
        setTimeout(() => {
          animating -= 1;
        }, online.length * 40 + 120),
      );
    };

    let waitHop = 0;
    const waitPulse = setInterval(() => {
      if (runIdRef.current !== runId || tokenCount > 0) {
        clearInterval(waitPulse);
        return;
      }
      const node = online[waitHop % online.length]!;
      waitHop += 1;
      firePulse(`hop-${node.index}`, node.tone, 500);
      patch(node, { status: "computing", load: 0.35 + Math.random() * 0.2 });
      nodeLog(node, `awaiting upstream · hop probe ${waitHop}`);
      timers.current.push(
        setTimeout(() => patch(node, { status: "receiving", load: 0.2 }), 400),
      );
    }, 700);

    try {
      setPhase("paying");
      orch(`POST /v1/chat/completions  ·  model=${API_CONFIG.model}`, "cyan", "client");

      for (const node of online) {
        guard();
        firePulse(`dispatch-${node.index}`, node.tone, 620);
        patch(node, { status: "receiving", load: 0.2 });
        nodeLog(node, `session open · ${node.host}`);
      }

      orch("signing x402 payment via HashPack", "amber", "hedera");
      const result = await paidChatCompletion(accountId, prompt, {
        model: API_CONFIG.model,
        maxTokens: API_CONFIG.maxTokens,
      });
      guard();
      setPhase("routing");
      orch(
        `swarm_manifest = ${online
          .map((n) => `${n.label}[${n.blocks[0]}:${n.blocks[1]}]`)
          .join(" -> ")}`,
        "lime",
      );
      orch(`route inference to TAIL ${tail.label}[${tail.blocks[0]}:${tail.blocks[1]}]`, "magenta");
      setPhase("streaming");

      await streamTokens(result.content, (token) => {
        guard();
        tokenCount += 1;
        expectedTokens = Math.max(expectedTokens, tokenCount + 4);
        setTotalTokens(expectedTokens);
        setTokenIndex(tokenCount);
        setTokens((prev) => [...prev, token]);
        scheduleTokenAnimation(token, tokenCount);
      });

      clearInterval(waitPulse);
      await new Promise((r) => timers.current.push(setTimeout(r, online.length * 50 + 200)));
      guard();
      setTotalTokens(tokenCount);
      for (const node of online) patch(node, { status: "done", load: 0 });
      orch("stream complete · EOS", "cyan", tail.label);

      if (result.payment) {
        const receipt = parsePaymentReceipt(result.payment);
        if (receipt) {
          setPayment(receipt);
          if (receipt.x402_tx_id) {
            orch(
              `x402 escrow settled · ${receipt.x402_tx_id}`,
              "amber",
              "hedera",
              hederaExplorerTx(receipt.x402_tx_id),
            );
          }
          if (receipt.payout_tx_id) {
            orch(
              `payout tx · ${receipt.payout_tx_id}`,
              "lime",
              "hedera",
              hederaExplorerTx(receipt.payout_tx_id),
            );
          }
          if (receipt.hcs_topic_id) {
            orch(
              `HCS audit · ${receipt.hcs_topic_id}#${receipt.hcs_sequence ?? "?"}`,
              "cyan",
              "hedera",
              hederaExplorerTopic(receipt.hcs_topic_id),
            );
          }
          for (const h of receipt.hosts ?? []) {
            const amt = h.amount_tinybars ? ` +${tinybarsToHbar(h.amount_tinybars)} HBAR` : "";
            orch(
              `${h.ens_name || h.host_id} → ${h.hedera_account_id}${amt}`,
              "violet",
              "payout",
            );
          }
        } else {
          orch(`payouts distributed · ${online.length} host(s)`, "amber", "gateway");
        }
      }
      setPhase("complete");
    } catch (err) {
      if (err !== CANCELLED) {
        orch(err instanceof Error ? err.message : String(err), "amber", "orchestrator");
        setPhase("idle");
      }
    } finally {
      clearInterval(waitPulse);
    }
  }, [manifestComplete, nodes, online, orch, prompt]);

  return {
    nodes,
    online,
    totalLayers,
    manifestComplete,
    motherUrl,
    pollError,
    phase,
    runtime,
    orchLogs,
    tokens,
    pulses,
    activeWires,
    tokenIndex,
    totalTokens,
    prompt,
    setPrompt,
    payment,
    run,
    reset,
  };
}

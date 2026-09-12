import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { CodePanel } from "@/components/sim/CodePanel";
import { NodeCard } from "@/components/sim/NodeCard";
import { ResultPanel } from "@/components/sim/ResultPanel";
import { WireCanvas, type Wire } from "@/components/sim/WireCanvas";
import { useSwarmSimulation } from "@/components/sim/useSwarmSimulation";
import { ConnectWalletButton } from "@/components/wallet/ConnectWalletButton";
import { useWallet } from "@/components/wallet/wallet-context";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Swarm Console · Blitzwing Live" },
      {
        name: "description",
        content:
          "Live visualization of Blitzwing distributed inference across real mother and contributor nodes.",
      },
      { property: "og:title", content: "Swarm Console · Blitzwing Live" },
      {
        property: "og:description",
        content:
          "Watch paid x402 chat completions fan out across live VM shards with real ENS host identities.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SwarmConsole,
});

function SwarmConsole() {
  const sim = useSwarmSimulation();
  const wallet = useWallet();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const codePanelRef = useRef<HTMLDivElement | null>(null);
  const railRefs = useRef(new Map<number, HTMLDivElement | null>());
  const cardRefs = useRef(new Map<number, HTMLDivElement | null>());
  const resultRef = useRef<HTMLDivElement | null>(null);
  const [wires, setWires] = useState<Wire[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [railTops, setRailTops] = useState<Record<number, number>>({});

  const measure = useCallback(() => {
    const host = containerRef.current;
    const result = resultRef.current;
    if (!host || !result) return;
    const base = host.getBoundingClientRect();
    setSize({ w: base.width, h: base.height });

    const rel = (r: DOMRect) => ({
      left: r.left - base.left,
      right: r.right - base.left,
      top: r.top - base.top,
      bottom: r.bottom - base.top,
      cx: r.left - base.left + r.width / 2,
      cy: r.top - base.top + r.height / 2,
    });

    const target = rel(result.getBoundingClientRect());
    const codePanel = codePanelRef.current;
    const next: Wire[] = [];
    const onlineNodes = sim.nodes.filter((n) => n.online);
    const nextRailTops: Record<number, number> = {};

    if (codePanel) {
      const code = rel(codePanel.getBoundingClientRect());
      sim.nodes.forEach((node) => {
        const card = cardRefs.current.get(node.index);
        if (!card) return;
        const b = rel(card.getBoundingClientRect());
        nextRailTops[node.index] = b.cy - code.top;
      });
    }

    sim.nodes.forEach((node) => {
      const rail = railRefs.current.get(node.index);
      const card = cardRefs.current.get(node.index);
      if (!rail || !card) return;
      const a = rel(rail.getBoundingClientRect());
      const b = rel(card.getBoundingClientRect());
      const dx = Math.max(70, (b.left - a.right) * 0.62);

      next.push({
        id: `dispatch-${node.index}`,
        tone: node.tone,
        dim: !node.online,
        d: `M ${a.cx} ${a.cy} C ${a.cx + dx} ${a.cy}, ${b.left - dx} ${b.cy}, ${b.left - 2} ${b.cy}`,
      });

      const cdx = Math.max(60, (target.left - b.right) * 0.6);
      next.push({
        id: `collect-${node.index}`,
        tone: node.index === (onlineNodes[onlineNodes.length - 1]?.index ?? -1) ? "lime" : node.tone,
        dim: !node.online,
        d: `M ${b.right + 2} ${b.cy} C ${b.right + cdx} ${b.cy}, ${target.left - cdx} ${
          target.cy
        }, ${target.left - 2} ${target.cy}`,
      });
    });

    for (let i = 0; i < onlineNodes.length - 1; i += 1) {
      const from = onlineNodes[i]!;
      const to = onlineNodes[i + 1]!;
      const fc = cardRefs.current.get(from.index);
      const tc = cardRefs.current.get(to.index);
      if (!fc || !tc) continue;
      const a = rel(fc.getBoundingClientRect());
      const b = rel(tc.getBoundingClientRect());
      const bow = 54;
      next.push({
        id: `hop-${from.index}`,
        tone: from.tone,
        d: `M ${a.cx + 40} ${a.bottom - 2} C ${a.cx + 40 + bow} ${a.bottom + 26}, ${
          b.cx + 40 + bow
        } ${b.top - 26}, ${b.cx + 40} ${b.top + 2}`,
      });
    }

    setWires(next);
    setRailTops(nextRailTops);
  }, [sim.nodes]);

  useLayoutEffect(() => {
    const raf = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(raf);
  }, [measure, sim.nodes.length]);

  useEffect(() => {
    const host = containerRef.current;
    if (!host) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(host);
    window.addEventListener("resize", measure);
    const t = setTimeout(measure, 350);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
      clearTimeout(t);
    };
  }, [measure]);

  const running = sim.phase !== "idle" && sim.phase !== "complete";
  const tail = sim.online[sim.online.length - 1];

  return (
    <main className="grid-canvas min-h-screen bg-background">
      <div
        className="pointer-events-none fixed inset-0"
        style={{
          background:
            "radial-gradient(120% 80% at 12% 0%, color-mix(in oklab, var(--tone-violet) 12%, transparent), transparent 60%), radial-gradient(100% 70% at 95% 100%, color-mix(in oklab, var(--tone-cyan) 10%, transparent), transparent 60%)",
        }}
      />

      <div className="relative mx-auto max-w-[1680px] px-6 py-7 lg:px-10">
        <header className="flex flex-wrap items-end justify-between gap-6 border-b border-hairline pb-5">
          <div>
            <div className="flex items-center gap-3">
              <span className="h-6 w-1.5 bg-accent" />
              <h1 className="text-2xl font-semibold tracking-tight">
                Swarm Console
                <span className="ml-3 font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                  blitzwing · live swarm
                </span>
              </h1>
            </div>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              One paid chat completion, sharded across every online host. Hidden states hop
              host&nbsp;→&nbsp;host over the HTTP chain; only the tail node runs{" "}
              <span className="font-mono text-amber">lm_head</span> and samples the next token.
            </p>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div className="panel flex flex-col gap-1 rounded-lg px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              <span>swarm</span>
              <span className="text-[13px] normal-case tracking-normal text-foreground">
                {sim.online.length}/{sim.nodes.length} hosts · {sim.totalLayers} blocks
              </span>
            </div>

            <div className="panel flex flex-col gap-1 rounded-lg px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              <span>manifest</span>
              <span
                className={`text-[13px] normal-case tracking-normal ${
                  sim.manifestComplete ? "text-lime" : "text-amber"
                }`}
              >
                {sim.manifestComplete ? "complete" : "incomplete"}
              </span>
            </div>

            <div className="panel flex flex-col gap-1 rounded-lg px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              <span>mother</span>
              <span className="max-w-[220px] truncate text-[11px] normal-case tracking-normal text-foreground">
                {sim.motherUrl ?? "discovering…"}
              </span>
            </div>

            {sim.pollError ? (
              <div className="panel rounded-lg px-3 py-2 font-mono text-[10px] text-amber">
                {sim.pollError}
              </div>
            ) : null}

            <ConnectWalletButton />
          </div>
        </header>

        <div
          ref={containerRef}
          className="relative mt-7 grid grid-cols-1 items-stretch gap-8 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1fr)_minmax(0,0.95fr)] xl:gap-14"
        >
          <WireCanvas
            width={size.w}
            height={size.h}
            wires={wires}
            pulses={sim.pulses}
            activeWires={sim.activeWires}
          />

          <div ref={codePanelRef} className="relative z-10">
            <CodePanel
              nodes={sim.nodes}
              running={running}
              walletConnected={Boolean(wallet.accountId)}
              onRun={() => void sim.run(wallet.accountId)}
              onReset={sim.reset}
              phase={sim.phase}
              prompt={sim.prompt}
              onPromptChange={sim.setPrompt}
            />
            {sim.nodes.map((n) => {
              const top = railTops[n.index];
              if (top == null) return null;
              return (
                <div
                  key={n.id}
                  ref={(el) => {
                    railRefs.current.set(n.index, el);
                    if (el) requestAnimationFrame(measure);
                  }}
                  className={`tone-${n.tone} pointer-events-none absolute -right-[7px] h-3 w-3 -translate-y-1/2 rotate-45 border tone-border tone-bg-soft transition-[top] duration-300 ${
                    n.online ? "" : "opacity-30"
                  }`}
                  style={{ top }}
                />
              );
            })}
          </div>

          <div className="relative z-10 flex min-h-0 flex-col justify-evenly gap-3">
            {sim.nodes.length === 0 ? (
              <div className="panel rounded-xl px-4 py-8 text-center font-mono text-sm text-muted-foreground">
                Waiting for hosts from discovery…
              </div>
            ) : (
              sim.nodes.map((node) => (
                <NodeCard
                  key={node.id}
                  node={node}
                  totalLayers={sim.totalLayers}
                  state={
                    sim.runtime[node.id] ?? {
                      status: node.online ? "idle" : "offline",
                      load: 0,
                      hops: 0,
                      lastMs: 0,
                      kv: 0,
                      logs: [],
                    }
                  }
                  anchorRef={(el) => {
                    cardRefs.current.set(node.index, el);
                    if (el) requestAnimationFrame(measure);
                  }}
                />
              ))
            )}
          </div>

          <div className="relative z-10">
            <ResultPanel
              anchorRef={(el) => {
                resultRef.current = el;
              }}
              tokens={sim.tokens}
              tokenIndex={sim.tokenIndex}
              totalTokens={sim.totalTokens || 1}
              phase={sim.phase}
              logs={sim.orchLogs}
              tail={tail}
              payment={sim.payment}
            />
          </div>
        </div>
      </div>
    </main>
  );
}

import type { OrchLog, PaymentReceipt, Phase, SwarmNode, Tone } from "./types";
import { SettlementPanel } from "./SettlementPanel";

const TONE_TEXT: Record<Tone, string> = {
  cyan: "text-cyan",
  magenta: "text-accent",
  amber: "text-amber",
  lime: "text-lime",
  violet: "text-violet",
};

export function ResultPanel({
  anchorRef,
  tokens,
  tokenIndex,
  totalTokens,
  elapsed,
  phase,
  logs,
  tail,
  payment,
}: {
  anchorRef: (el: HTMLDivElement | null) => void;
  tokens: string[];
  tokenIndex: number;
  totalTokens: number;
  elapsed: number;
  phase: Phase;
  logs: OrchLog[];
  tail?: SwarmNode;
  payment: PaymentReceipt | null;
}) {
  const streaming = phase === "streaming";
  const seconds = (elapsed / 1000).toFixed(2);
  const tps = elapsed > 0 && tokens.length ? (tokens.length / (elapsed / 1000)).toFixed(1) : "0.0";

  return (
    <div className="flex flex-col gap-5">
      <div ref={anchorRef} className="panel relative overflow-hidden rounded-xl">
        <div className="flex items-center justify-between border-b border-hairline bg-surface-raised/60 px-4 py-2.5">
          <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
            completion · streamed
          </span>
          <span
            className={`font-mono text-[10.5px] uppercase tracking-[0.16em] ${
              phase === "complete" ? "text-lime" : streaming ? "text-accent" : "text-muted-foreground"
            }`}
          >
            {phase === "complete" ? "finish_reason=stop" : streaming ? "receiving" : phase}
          </span>
        </div>

        <div className="px-4 py-4">
          <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground">
            assistant {tail ? `· sampled on ${tail.label}` : ""}
          </p>
          <div className="mt-2 min-h-[132px] font-mono text-[13.5px] leading-[1.75] text-foreground">
            {tokens.length === 0 && phase === "idle" ? (
              <span className="text-muted-foreground/60">
                press run to dispatch the request through the swarm…
              </span>
            ) : (
              <>
                {tokens.map((t, i) => (
                  <span
                    key={i}
                    className="animate-token-in inline"
                    style={{ color: i === tokens.length - 1 ? "var(--tone-lime)" : undefined }}
                  >
                    {t}
                  </span>
                ))}
                {phase !== "complete" && (
                  <span className="ml-0.5 inline-block h-4 w-2 translate-y-0.5 animate-status-blink bg-lime align-middle" />
                )}
              </>
            )}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-px bg-hairline/60 font-mono text-[10px]">
          {[
            ["tokens", `${tokenIndex}/${totalTokens}`],
            ["wall clock", `${seconds}s`],
            ["throughput", `${tps} tok/s`],
          ].map(([k, v]) => (
            <div key={k} className="bg-surface px-3 py-2.5">
              <p className="uppercase tracking-[0.14em] text-muted-foreground">{k}</p>
              <p className="mt-0.5 text-[13px] text-foreground">{v}</p>
            </div>
          ))}
        </div>

        <div className="h-1 w-full bg-surface-sunken">
          <div
            className="h-full bg-lime transition-all duration-200"
            style={{ width: `${(tokenIndex / totalTokens) * 100}%` }}
          />
        </div>
      </div>

      <SettlementPanel payment={payment} />

      <div className="panel flex min-h-0 flex-col overflow-hidden rounded-xl">
        <div className="flex items-center justify-between border-b border-hairline bg-surface-raised/60 px-4 py-2.5">
          <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
            orchestrator trace
          </span>
          <span className="font-mono text-[10px] text-muted-foreground/70">{logs.length} events</span>
        </div>
        <div className="flex max-h-[260px] flex-col gap-1.5 overflow-y-auto px-4 py-3 font-mono text-[11px]">
          {logs.length === 0 && (
            <p className="text-muted-foreground/60">no events · swarm idle</p>
          )}
          {logs.map((l) => (
            <p key={l.id} className="animate-rise-in break-words leading-snug">
              <span className={`${TONE_TEXT[l.tone]} uppercase tracking-[0.1em]`}>[{l.scope}]</span>{" "}
              <span className="text-muted-foreground">{l.text}</span>
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}

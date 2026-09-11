import { type NodeRuntime, type NodeStatus, type SwarmNode } from "./types";

const STATUS_COPY: Record<NodeStatus, string> = {
  offline: "OFFLINE",
  idle: "IDLE",
  receiving: "SESSION OPEN",
  computing: "RPC_FORWARD",
  emitting: "SHIPPING HIDDEN",
  done: "SETTLED",
};

const ROLE_COPY = {
  mother: "prefix",
  relay: "relay",
  tail: "tail · lm_head",
} as const;

export function NodeCard({
  node,
  state,
  onToggle,
  anchorRef,
  totalLayers,
}: {
  node: SwarmNode;
  state: NodeRuntime;
  onToggle?: () => void;
  anchorRef: (el: HTMLDivElement | null) => void;
  totalLayers: number;
}) {
  const busy = state.status === "computing" || state.status === "emitting";
  const [start, end] = node.blocks;
  const meta = [node.region, node.ensName, node.hederaAccountId].filter(Boolean).join(" · ");

  return (
    <div
      ref={anchorRef}
      className={`tone-${node.tone} panel relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg transition-transform duration-300 ${
        busy ? "-translate-y-px scale-[1.01]" : ""
      } ${node.online ? "" : "opacity-45 saturate-0"}`}
      style={{
        borderColor: busy
          ? "color-mix(in oklab, var(--tone) 70%, transparent)"
          : "color-mix(in oklab, var(--tone) 24%, var(--hairline))",
      }}
    >
      <div
        className="absolute inset-y-0 left-0 w-[2px] tone-fill transition-opacity duration-300"
        style={{ opacity: busy ? 1 : 0.35 }}
      />
      {busy && (
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-10 animate-scan-sweep"
          style={{
            background:
              "linear-gradient(to bottom, transparent, color-mix(in oklab, var(--tone) 16%, transparent), transparent)",
          }}
        />
      )}

      <div className="flex shrink-0 items-start justify-between gap-2 px-3 pt-2.5">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span
              className={`h-1 w-1 shrink-0 rounded-full tone-fill ${busy ? "animate-status-blink" : ""}`}
              style={{ opacity: node.online ? 1 : 0.3 }}
            />
            <span className="truncate font-mono text-[11px] font-medium tracking-tight tone-text">
              {node.label}
            </span>
            <span className="shrink-0 rounded border border-border px-1 py-px font-mono text-[8px] uppercase tracking-widest text-muted-foreground">
              {node.role}
            </span>
          </div>
          <p
            className="mt-0.5 truncate font-mono text-[9px] text-muted-foreground"
            title={`${node.host} · ${meta}`}
          >
            {meta || node.host}
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-0.5">
          <span className="font-mono text-[8px] uppercase tracking-[0.12em] tone-text">
            {STATUS_COPY[state.status]}
          </span>
          {onToggle ? (
            <button
              onClick={onToggle}
              className="rounded border border-border px-1.5 py-px font-mono text-[8px] uppercase tracking-widest text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
            >
              {node.online ? "offline" : "online"}
            </button>
          ) : (
            <span className="font-mono text-[8px] text-muted-foreground/70">
              {node.online ? "live" : "offline"}
            </span>
          )}
        </div>
      </div>

      <div className="shrink-0 px-3 pt-2">
        <div className="flex items-center justify-between font-mono text-[8px] uppercase tracking-[0.14em] text-muted-foreground">
          <span>L{start}–{end}</span>
          <span>{ROLE_COPY[node.role]}</span>
        </div>
        <div className="mt-1 flex gap-px">
          {Array.from({ length: totalLayers }, (_, i) => {
            const owned = i >= start && i < end;
            return (
              <span
                key={i}
                className={`h-2.5 flex-1 rounded-[1px] transition-all duration-300 ${
                  owned ? "tone-fill" : "bg-surface-sunken"
                }`}
                style={{
                  opacity: owned ? (busy ? 1 : 0.55) : 0.4,
                  transform: owned && busy ? "scaleY(1.1)" : "none",
                  transitionDelay: `${(i - start) * 18}ms`,
                }}
              />
            );
          })}
        </div>
      </div>

      <div className="mt-2 grid shrink-0 grid-cols-3 gap-px bg-hairline/60 font-mono text-[8px]">
        {[
          ["hops", String(state.hops)],
          ["last", `${state.lastMs}ms`],
          ["kv", `${state.kv}%`],
        ].map(([k, v]) => (
          <div key={k} className="bg-surface px-2 py-1">
            <p className="uppercase tracking-[0.12em] text-muted-foreground">{k}</p>
            <p className="text-[10px] text-foreground">{v}</p>
          </div>
        ))}
      </div>

      <div className="flex shrink-0 items-end gap-[2px] px-3 pt-2">
        {Array.from({ length: 22 }, (_, i) => (
          <span
            key={i}
            className="h-4 flex-1 origin-bottom rounded-[1px] tone-fill"
            style={{
              opacity: busy ? 0.22 + state.load * 0.6 : 0.12,
              animation: busy ? `bar-pulse ${0.5 + (i % 6) * 0.09}s ease-in-out infinite` : "none",
              transform: busy ? undefined : "scaleY(0.18)",
            }}
          />
        ))}
      </div>

      <div className="mt-auto min-h-0 flex-1 overflow-hidden hairline-x bg-surface-sunken/70 px-3 py-1.5 font-mono text-[9px] leading-snug">
        {state.logs.length === 0 ? (
          <p className="text-muted-foreground/60">idle…</p>
        ) : (
          state.logs.slice(-2).map((l, i) => (
            <p key={`${node.id}-log-${i}`} className="animate-token-in truncate text-muted-foreground">
              <span className="tone-text">› </span>
              {l}
            </p>
          ))
        )}
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import type { Pulse, Tone } from "./types";

export interface Wire {
  id: string;
  d: string;
  tone: Tone;
  dim?: boolean;
}

interface LivePulse extends Pulse {
  start: number;
}

const TONE_VAR: Record<Tone, string> = {
  cyan: "var(--tone-cyan)",
  magenta: "var(--tone-magenta)",
  amber: "var(--tone-amber)",
  lime: "var(--tone-lime)",
  violet: "var(--tone-violet)",
};

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

export function WireCanvas({
  width,
  height,
  wires,
  pulses,
  activeWires,
}: {
  width: number;
  height: number;
  wires: Wire[];
  pulses: Pulse[];
  activeWires: string[];
}) {
  const pathRefs = useRef(new Map<string, SVGPathElement | null>());
  const groupRefs = useRef(new Map<string, SVGGElement | null>());
  const seen = useRef(new Set<string>());
  const [live, setLive] = useState<LivePulse[]>([]);
  const liveRef = useRef<LivePulse[]>([]);
  liveRef.current = live;

  useEffect(() => {
    if (pulses.length === 0) {
      seen.current.clear();
      setLive([]);
      return;
    }
    const fresh = pulses.filter((p) => !seen.current.has(p.key));
    if (!fresh.length) return;
    fresh.forEach((p) => seen.current.add(p.key));
    const now = performance.now();
    setLive((prev) => {
      const active = new Set(prev.map((p) => p.key));
      const toAdd = fresh.filter((p) => !active.has(p.key)).map((p) => ({ ...p, start: now }));
      return toAdd.length ? [...prev, ...toAdd] : prev;
    });
  }, [pulses]);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const now = performance.now();
      const finished: string[] = [];
      for (const p of liveRef.current) {
        const path = pathRefs.current.get(p.wire);
        const g = groupRefs.current.get(p.key);
        const t = (now - p.start) / p.duration;
        if (t >= 1 || !path) {
          finished.push(p.key);
          continue;
        }
        if (!g) continue;
        const len = path.getTotalLength();
        const head = ease(Math.min(1, t));
        const children = Array.from(g.children) as SVGCircleElement[];
        children.forEach((child, i) => {
          const at = Math.max(0, head - i * 0.03);
          const pt = path.getPointAtLength(len * at);
          child.setAttribute("cx", String(pt.x));
          child.setAttribute("cy", String(pt.y));
        });
        const fade = t < 0.08 ? t / 0.08 : t > 0.9 ? (1 - t) / 0.1 : 1;
        g.setAttribute("opacity", String(Math.max(0, fade)));
      }
      if (finished.length) {
        setLive((prev) => prev.filter((p) => !finished.includes(p.key)));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${Math.max(1, width)} ${Math.max(1, height)}`}
      className="pointer-events-none absolute inset-0"
      aria-hidden="true"
    >
      {wires.map((w) => {
        const active = activeWires.includes(w.id);
        const color = TONE_VAR[w.tone];
        return (
          <g key={w.id}>
            <path
              d={w.d}
              fill="none"
              stroke={color}
              strokeOpacity={w.dim ? 0.1 : active ? 0.5 : 0.22}
              strokeWidth={active ? 2.4 : 1.4}
              className="transition-all duration-200"
            />
            <path
              ref={(el) => {
                pathRefs.current.set(w.id, el);
              }}
              d={w.d}
              fill="none"
              stroke={color}
              strokeOpacity={active ? 0.95 : 0.34}
              strokeWidth={1.2}
              strokeDasharray="5 19"
              className={active ? "animate-marquee-dash" : ""}
            />
          </g>
        );
      })}

      {live.map((p) => (
        <g
          key={p.key}
          ref={(el) => {
            groupRefs.current.set(p.key, el);
          }}
          opacity={0}
        >
          <circle r={5} fill={TONE_VAR[p.tone]} />
          <circle r={3.6} fill={TONE_VAR[p.tone]} opacity={0.6} />
          <circle r={2.4} fill={TONE_VAR[p.tone]} opacity={0.35} />
          <circle r={1.4} fill={TONE_VAR[p.tone]} opacity={0.2} />
        </g>
      ))}
    </svg>
  );
}

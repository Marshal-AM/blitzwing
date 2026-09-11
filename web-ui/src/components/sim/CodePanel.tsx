import type { SwarmNode } from "./types";

const CODE: { text: string; kind: "kw" | "str" | "fn" | "num" | "cmt" | "plain" }[][] = [
  [{ text: "# x402 paid inference client", kind: "cmt" }],
  [{ text: "import requests", kind: "kw" }],
  [{ text: "", kind: "plain" }],
  [
    { text: "response", kind: "plain" },
    { text: " = ", kind: "plain" },
    { text: "requests.post", kind: "fn" },
    { text: "(", kind: "plain" },
  ],
  [
    { text: '    "', kind: "plain" },
    { text: "http://gateway/v1/chat/completions", kind: "str" },
    { text: '",', kind: "plain" },
  ],
  [
    { text: "    json", kind: "plain" },
    { text: "={", kind: "plain" },
  ],
  [
    { text: '        "model"', kind: "plain" },
    { text: ": ", kind: "plain" },
    { text: '"bigscience/bloom-560m"', kind: "str" },
    { text: ",", kind: "plain" },
  ],
  [
    { text: '        "messages"', kind: "plain" },
    { text: ": [{", kind: "plain" },
    { text: '"role"', kind: "str" },
    { text: ": ", kind: "plain" },
    { text: '"user"', kind: "str" },
    { text: ", ", kind: "plain" },
    { text: '"content"', kind: "str" },
    { text: ": ", kind: "plain" },
    { text: "PROMPT", kind: "plain" },
    { text: "}],", kind: "plain" },
  ],
  [
    { text: '        "stream"', kind: "plain" },
    { text: ": ", kind: "plain" },
    { text: "True", kind: "kw" },
    { text: ",", kind: "plain" },
  ],
  [{ text: "    },", kind: "plain" }],
  [{ text: "    stream=True,", kind: "plain" }],
  [{ text: ")", kind: "plain" }],
  [{ text: "", kind: "plain" }],
  [
    { text: "for chunk in response.iter_lines", kind: "fn" },
    { text: "():", kind: "plain" },
  ],
  [
    { text: "    print", kind: "fn" },
    { text: "(json.loads(chunk)[", kind: "plain" },
    { text: '"choices"', kind: "str" },
    { text: "][0][", kind: "plain" },
    { text: '"delta"', kind: "str" },
    { text: "][", kind: "plain" },
    { text: '"content"', kind: "str" },
    { text: "])", kind: "plain" },
  ],
];

const CLASS: Record<string, string> = {
  kw: "text-violet",
  str: "text-amber",
  fn: "text-cyan",
  num: "text-lime",
  cmt: "text-muted-foreground/70 italic",
  plain: "text-foreground/85",
};

export function CodePanel({
  nodes,
  running,
  onRun,
  onReset,
  phase,
  prompt,
  onPromptChange,
}: {
  nodes: SwarmNode[];
  running: boolean;
  onRun: () => void;
  onReset: () => void;
  phase: string;
  prompt: string;
  onPromptChange: (value: string) => void;
}) {
  return (
    <div className="panel relative flex flex-col overflow-hidden rounded-xl">
      <div className="flex items-center justify-between gap-3 border-b border-hairline bg-surface-raised/60 px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          <div className="flex gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-destructive/80" />
            <span className="h-2.5 w-2.5 rounded-full bg-amber/80" />
            <span className="h-2.5 w-2.5 rounded-full bg-lime/80" />
          </div>
          <span className="font-mono text-[11px] tracking-tight text-muted-foreground">
            client/infer.py
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onReset}
            className="rounded-md border border-border px-2.5 py-1 font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
          >
            reset
          </button>
          <button
            onClick={onRun}
            disabled={running}
            className="group relative flex items-center gap-2 overflow-hidden rounded-md bg-cyan px-3.5 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-primary-foreground transition-transform duration-150 hover:-translate-y-px active:translate-y-0 disabled:opacity-60"
          >
            <span
              className={`h-0 w-0 border-y-[5px] border-l-[8px] border-y-transparent border-l-current ${
                running ? "animate-status-blink" : ""
              }`}
            />
            {running ? "running" : "run"}
          </button>
        </div>
      </div>

      <pre className="relative flex-1 overflow-x-auto px-4 py-4 font-mono text-[12.5px] leading-[1.85]">
        {CODE.map((line, i) => {
          const hot = running && i >= 3 && i <= 11;
          return (
            <div
              key={i}
              className={`-mx-2 flex gap-4 rounded px-2 transition-colors duration-300 ${
                hot ? "bg-cyan/10" : ""
              }`}
            >
              <span className="w-4 shrink-0 select-none text-right text-muted-foreground/40">
                {i + 1}
              </span>
              <span className="whitespace-pre">
                {line.map((tok, j) => (
                  <span key={j} className={CLASS[tok.kind]}>
                    {tok.text}
                  </span>
                ))}
              </span>
            </div>
          );
        })}
      </pre>

      <div className="border-t border-hairline bg-surface-sunken/70 px-4 py-3">
        <label className="flex flex-col gap-1.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            prompt
          </span>
          <textarea
            value={prompt}
            onChange={(e) => onPromptChange(e.target.value)}
            disabled={running}
            rows={2}
            className="resize-none rounded-md border border-border bg-surface px-3 py-2 font-mono text-[12px] text-foreground outline-none focus:border-cyan disabled:opacity-60"
          />
        </label>
      </div>

      <div className="flex items-center justify-between border-t border-hairline bg-surface-sunken/70 px-4 py-2 font-mono text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground">
        <span>egress · {nodes.filter((n) => n.online).length} peer sessions</span>
        <span className="text-cyan">{phase}</span>
      </div>
    </div>
  );
}

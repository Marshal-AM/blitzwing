import path from "node:path";
import { fileURLToPath } from "node:url";
import { createFileRoute } from "@tanstack/react-router";
import { config as loadEnv } from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(__dirname, "../../../.env") });
loadEnv({ path: path.resolve(__dirname, "../../../../.env") });

const DISCOVERY_URL = (
  process.env.VITE_DISCOVERY_URL || "http://136.113.30.202:9000"
).replace(/\/$/, "");
const MODEL = process.env.VITE_BLITZWING_MODEL || "HuggingFaceTB/SmolLM2-360M-Instruct";

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

export const Route = createFileRoute("/api/swarm")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const mothers = await fetchJson<
            Array<{ model: string; mother_url: string; total_layers: number }>
          >(`${DISCOVERY_URL}/v1/mothers`);

          const mother =
            mothers.find((m) => m.model === MODEL) ??
            (await fetchJson<{ model: string; mother_url: string; total_layers: number }>(
              `${DISCOVERY_URL}/v1/mothers/${encodeURIComponent(MODEL)}`,
            ).catch(() => null));

          if (!mother) {
            return new Response(
              JSON.stringify({ error: `No mother registered for ${MODEL}` }),
              { status: 404, headers: { "content-type": "application/json" } },
            );
          }

          const base = mother.mother_url.replace(/\/$/, "");
          const [hosts, manifest] = await Promise.all([
            fetchJson<unknown>(`${base}/v1/hosts`),
            fetchJson<unknown>(`${base}/v1/swarm/manifest`),
          ]);

          return new Response(
            JSON.stringify({
              discoveryUrl: DISCOVERY_URL,
              motherUrl: mother.mother_url,
              model: MODEL,
              hosts,
              manifest,
            }),
            { headers: { "content-type": "application/json" } },
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return new Response(JSON.stringify({ error: message }), {
            status: 502,
            headers: { "content-type": "application/json" },
          });
        }
      },
    },
  },
});

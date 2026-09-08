/**
 * Public x402 payment gateway for Blitzwing.
 *
 * Official Hedera x402 stack (same as x500 example/server):
 *   @x402/core  — x402ResourceServer + x402HTTPResourceServer
 *   @x402/hedera — ExactHederaScheme (exact / HBAR)
 *
 * Flow: processHTTPRequest → processSettlement → proxy to FastAPI
 * (inference + layer-weighted HBAR redistribution + HCS).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { config } from "dotenv";
import { x402ResourceServer } from "@x402/core/server";
import {
  HTTPFacilitatorClient,
  x402HTTPResourceServer,
} from "@x402/core/http";
import { ExactHederaScheme } from "@x402/hedera/exact/server";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "../../.env") });
config();

/** Local x500 facilitator (@x500/facilitator on FACILITATOR_PORT). */
const DEFAULT_FACILITATOR_URL = "http://127.0.0.1:8791";

const facilitatorUrl = (
  process.env.FACILITATOR_URL || DEFAULT_FACILITATOR_URL
).replace(/\/$/, "");
const payTo = (process.env.MOTHER_ACCOUNT_ID || "").trim();
const upstream = (
  process.env.ORCHESTRATOR_INTERNAL_URL || "http://127.0.0.1:8002"
).replace(/\/$/, "");
const port = Number(process.env.X402_GATEWAY_PORT || process.env.API_PORT || 8000);
const network = "hedera:testnet" as const;
const totalLayers = Number(process.env.TOTAL_LAYERS || 22);
const costPerLayer = Number(process.env.COST_PER_LAYER_TINYBARS || 0);
const x402Enabled = !["0", "false", "False"].includes(
  process.env.X402_ENABLED || "0",
);

if (x402Enabled && !/^0\.0\.\d+$/.test(payTo)) {
  console.error("X402_ENABLED requires MOTHER_ACCOUNT_ID (0.0.xxx) as payTo");
  process.exit(1);
}
if (x402Enabled && !(costPerLayer > 0)) {
  console.error("X402_ENABLED requires COST_PER_LAYER_TINYBARS > 0");
  process.exit(1);
}

const priceTinybars = String(totalLayers * costPerLayer);

function adapterFromHono(c: {
  req: {
    header: (name: string) => string | undefined;
    method: string;
    path: string;
    url: string;
  };
}) {
  return {
    getHeader: (name: string) => c.req.header(name) ?? undefined,
    getMethod: () => c.req.method,
    getPath: () => c.req.path,
    getUrl: () => c.req.url,
    getAcceptHeader: () => c.req.header("accept") ?? "application/json",
    getUserAgent: () => c.req.header("user-agent") ?? "blitzwing-x402-gateway",
  };
}

async function proxyUpstream(
  pathAndQuery: string,
  init: RequestInit,
): Promise<Response> {
  const url = `${upstream}${pathAndQuery}`;
  try {
    return await fetch(url, init);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({
        detail: `Upstream orchestrator unreachable at ${upstream}: ${message}`,
      }),
      { status: 502, headers: { "content-type": "application/json" } },
    );
  }
}

async function createApp(): Promise<Hono> {
  const app = new Hono();

  app.get("/health", async (c) => {
    const up = await proxyUpstream("/health", { method: "GET" });
    const text = await up.text();
    let body: Record<string, unknown> = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { upstream_raw: text.slice(0, 200) };
    }
    return c.json({
      ok: up.ok,
      service: "blitzwing-x402-gateway",
      x402_enabled: x402Enabled,
      payTo: x402Enabled ? payTo : null,
      priceTinybars: x402Enabled ? priceTinybars : null,
      network,
      facilitatorUrl,
      upstream,
      orchestrator: body,
    });
  });

  let httpServer: x402HTTPResourceServer | null = null;

  if (x402Enabled) {
    const facilitatorClient = new HTTPFacilitatorClient({ url: facilitatorUrl });
    const resourceServer = new x402ResourceServer(facilitatorClient);
    resourceServer.register(
      network,
      new ExactHederaScheme({
        defaultAssets: {
          [network]: { asset: "0.0.0", decimals: 8 },
        },
      }),
    );
    await resourceServer.initialize();

    httpServer = new x402HTTPResourceServer(resourceServer, {
      "POST /v1/chat/completions": {
        accepts: {
          scheme: "exact",
          payTo,
          price: { amount: priceTinybars, asset: "0.0.0" },
          network,
          maxTimeoutSeconds: 300,
        },
        description: `Blitzwing inference (${totalLayers} layers × ${costPerLayer} tinybars)`,
        mimeType: "application/json",
      },
    });
    await httpServer.initialize();

    console.log(
      `x402 gate ON  payTo=${payTo} price=${priceTinybars} tinybars network=${network}`,
    );
    console.log(`facilitator   ${facilitatorUrl}`);
  } else {
    console.log("x402 gate OFF (set X402_ENABLED=1 to require payment)");
  }

  app.post("/v1/chat/completions", async (c) => {
    const bodyBuf = await c.req.arrayBuffer();
    const reqPath = c.req.path;
    const method = c.req.method;

    if (httpServer) {
      const result = await httpServer.processHTTPRequest({
        adapter: adapterFromHono(c),
        path: reqPath,
        method,
      });

      if (result.type === "payment-error") {
        const { status, headers, body } = result.response;
        const outHeaders: Record<string, string> = {
          "content-type": "application/json",
        };
        for (const [k, v] of Object.entries(headers)) {
          outHeaders[k] = v;
        }
        return new Response(
          typeof body === "string" ? body : JSON.stringify(body ?? {}),
          { status, headers: outHeaders },
        );
      }

      if (result.type === "payment-verified") {
        const settle = await httpServer.processSettlement(
          result.paymentPayload,
          result.paymentRequirements,
        );
        const settleHeaders: Record<string, string> = {};
        for (const [k, v] of Object.entries(settle.headers ?? {})) {
          settleHeaders[k] = v;
        }
        if (!settle.success) {
          return new Response(
            JSON.stringify({
              error: "settlement_failed",
              errorReason: settle.errorReason,
              errorMessage: settle.errorMessage,
            }),
            {
              status: 402,
              headers: { "content-type": "application/json", ...settleHeaders },
            },
          );
        }

        const forwardHeaders = new Headers();
        const ct = c.req.header("content-type");
        if (ct) forwardHeaders.set("content-type", ct);
        else forwardHeaders.set("content-type", "application/json");
        forwardHeaders.set("X-Blitzwing-Paid", "1");
        if (settle.transaction) {
          forwardHeaders.set(
            "X-Blitzwing-X402-Tx-Id",
            String(settle.transaction),
          );
        }

        const up = await proxyUpstream(reqPath, {
          method: "POST",
          headers: forwardHeaders,
          body: bodyBuf,
        });
        const upBody = await up.arrayBuffer();
        const outHeaders: Record<string, string> = {
          "content-type":
            up.headers.get("content-type") || "application/json",
          ...settleHeaders,
        };
        return new Response(upBody, { status: up.status, headers: outHeaders });
      }

      // Protected route must not fall through unpaid.
      return c.json(
        {
          error: "payment_required",
          message: `Unexpected x402 result type: ${(result as { type: string }).type}`,
        },
        402,
      );
    }

    // Gate off — transparent proxy
    const forwardHeaders = new Headers();
    const ct = c.req.header("content-type");
    if (ct) forwardHeaders.set("content-type", ct);
    else forwardHeaders.set("content-type", "application/json");
    forwardHeaders.set("X-Blitzwing-Paid", "0");

    const up = await proxyUpstream(reqPath, {
      method: "POST",
      headers: forwardHeaders,
      body: bodyBuf,
    });
    const upBody = await up.arrayBuffer();
    return new Response(upBody, {
      status: up.status,
      headers: {
        "content-type": up.headers.get("content-type") || "application/json",
      },
    });
  });

  // All other routes → orchestrator (hosts, health already handled above, models, …)
  app.all("*", async (c) => {
    const url = new URL(c.req.url);
    const pathAndQuery = url.pathname + url.search;
    if (pathAndQuery === "/health") {
      // already registered; shouldn't hit
      return c.json({ ok: true });
    }
    const headers = new Headers();
    const ct = c.req.header("content-type");
    if (ct) headers.set("content-type", ct);
    const method = c.req.method;
    const init: RequestInit = { method, headers };
    if (method !== "GET" && method !== "HEAD") {
      init.body = await c.req.arrayBuffer();
    }
    const up = await proxyUpstream(pathAndQuery, init);
    const upBody = await up.arrayBuffer();
    return new Response(upBody, {
      status: up.status,
      headers: {
        "content-type": up.headers.get("content-type") || "application/json",
      },
    });
  });

  return app;
}

const app = await createApp();
serve({ fetch: app.fetch, port }, () => {
  console.log(
    `Blitzwing x402 gateway listening on :${port} → ${upstream}` +
      (x402Enabled ? ` (gated POST /v1/chat/completions)` : ""),
  );
});

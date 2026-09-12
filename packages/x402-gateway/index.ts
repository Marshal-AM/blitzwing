/**
 * Public x402 payment gateway for Blitzwing.
 *
 * Official Hedera x402 stack:
 *   @x402/core  — x402ResourceServer + x402HTTPResourceServer
 *   @x402/hedera — ExactHederaScheme (exact / HBAR)
 *
 * Flow: verify → settle to escrow (pre-pay) → proxy inference → distribute from escrow
 *
 * Payment is settled BEFORE inference starts to avoid Hedera tx expiry during
 * slow CPU inference. After inference completes, the escrow distributes to
 * compute providers based on their layer contributions.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
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

/** Local Blitzwing facilitator (packages/x402-facilitator). */
const DEFAULT_FACILITATOR_URL = "http://127.0.0.1:8791";

const facilitatorUrl = (
  process.env.FACILITATOR_URL || DEFAULT_FACILITATOR_URL
).replace(/\/$/, "");
const payTo = (
  process.env.ESCROW_CONTRACT_ID ||
  process.env.ESCROW_ACCOUNT_ID ||
  process.env.MOTHER_ACCOUNT_ID ||
  ""
).trim();
const upstream = (
  process.env.ORCHESTRATOR_INTERNAL_URL || "http://127.0.0.1:8002"
).replace(/\/$/, "");
const shardUpstream = (
  process.env.SHARD_MANAGER_INTERNAL_URL || "http://127.0.0.1:8001"
).replace(/\/$/, "");
const port = Number(process.env.X402_GATEWAY_PORT || process.env.API_PORT || 8000);
const network = "hedera:testnet" as const;
const totalLayers = Number(process.env.TOTAL_LAYERS || 32);
const costPerLayer = Number(process.env.COST_PER_LAYER_TINYBARS || 0);
const x402Enabled = !["0", "false", "False"].includes(
  process.env.X402_ENABLED || "0",
);

if (x402Enabled && !/^0\.0\.\d+$/.test(payTo)) {
  console.error(
    "X402_ENABLED requires MOTHER_ACCOUNT_ID or ESCROW_CONTRACT_ID (0.0.xxx) as payTo",
  );
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

const UPSTREAM_TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS || 300_000);

async function proxyUpstream(
  pathAndQuery: string,
  init: RequestInit,
): Promise<Response> {
  const url = `${upstream}${pathAndQuery}`;
  try {
    return await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
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

  app.use(
    "*",
    cors({
      origin: "*",
      allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowHeaders: ["*"],
    }),
  );

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
        // SETTLE PAYMENT FIRST (pre-pay into escrow) before inference starts
        // This prevents Hedera tx expiry during slow inference
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
              detail: "Payment settlement failed before inference",
            }),
            {
              status: 402,
              headers: { "content-type": "application/json", ...settleHeaders },
            },
          );
        }

        // Payment settled successfully - now run inference (can take as long as needed)
        const forwardHeaders = new Headers();
        const ct = c.req.header("content-type");
        if (ct) forwardHeaders.set("content-type", ct);
        else forwardHeaders.set("content-type", "application/json");
        forwardHeaders.set("X-Blitzwing-Paid", "verified");
        forwardHeaders.set("X-Blitzwing-X402-Tx-Id", String(settle.transaction || ""));

        const up = await proxyUpstream(reqPath, {
          method: "POST",
          headers: forwardHeaders,
          body: bodyBuf,
        });
        const upBody = await up.arrayBuffer();
        const upText = new TextDecoder().decode(upBody);

        if (!up.ok) {
          // Inference failed but payment already settled - log for reconciliation
          console.error(
            `Inference failed after payment settled (tx=${settle.transaction}):`,
            up.status,
            upText.slice(0, 500),
          );
          return new Response(upBody, {
            status: up.status,
            headers: {
              "content-type": up.headers.get("content-type") || "application/json",
              ...settleHeaders,
            },
          });
        }

        let responseBody: unknown = upText;
        try {
          responseBody = upText ? JSON.parse(upText) : null;
        } catch {
          /* keep raw */
        }

        const completionId =
          responseBody &&
          typeof responseBody === "object" &&
          "id" in responseBody &&
          typeof (responseBody as { id: unknown }).id === "string"
            ? (responseBody as { id: string }).id
            : null;

        // Distribute payment from escrow to compute providers
        if (completionId && settle.transaction) {
          try {
            const payoutRes = await fetch(`${upstream}/v1/internal/payout`, {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "X-Blitzwing-Paid": "1",
                "X-Blitzwing-X402-Tx-Id": String(settle.transaction),
              },
              body: JSON.stringify({ request_id: completionId }),
            });
            if (payoutRes.ok) {
              const payoutJson = await payoutRes.json();
              if (responseBody && typeof responseBody === "object") {
                (responseBody as Record<string, unknown>).blitzwing_payment =
                  payoutJson;
              }
            } else {
              console.error(
                "Payout from escrow failed:",
                payoutRes.status,
                await payoutRes.text(),
              );
            }
          } catch (err) {
            console.error("Payout request failed:", err);
          }
        }

        const outHeaders: Record<string, string> = {
          "content-type": up.headers.get("content-type") || "application/json",
          ...settleHeaders,
        };
        const finalBody =
          typeof responseBody === "string"
            ? responseBody
            : JSON.stringify(responseBody ?? {});
        return new Response(finalBody, { status: up.status, headers: outHeaders });
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

  // HTTP chain: contributor POSTs prefix/continue hidden-states through the public gateway.
  app.all("/v1/chain/prefix", async (c) => {
    const url = `${shardUpstream}/v1/chain/prefix`;
    const headers = new Headers();
    const ct = c.req.header("content-type");
    if (ct) headers.set("content-type", ct);
    const init: RequestInit = { method: c.req.method, headers };
    if (c.req.method !== "GET" && c.req.method !== "HEAD") {
      init.body = await c.req.arrayBuffer();
    }
    try {
      const up = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
      const upBody = await up.arrayBuffer();
      return new Response(upBody, {
        status: up.status,
        headers: {
          "content-type": up.headers.get("content-type") || "application/json",
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json(
        { detail: `Shard manager unreachable at ${shardUpstream}: ${message}` },
        502,
      );
    }
  });

  app.all("/v1/chain/continue", async (c) => {
    const url = `${shardUpstream}/v1/chain/continue`;
    const headers = new Headers();
    const ct = c.req.header("content-type");
    if (ct) headers.set("content-type", ct);
    const init: RequestInit = { method: c.req.method, headers };
    if (c.req.method !== "GET" && c.req.method !== "HEAD") {
      init.body = await c.req.arrayBuffer();
    }
    try {
      const up = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
      const upBody = await up.arrayBuffer();
      return new Response(upBody, {
        status: up.status,
        headers: {
          "content-type": up.headers.get("content-type") || "application/json",
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json(
        { detail: `Shard manager unreachable at ${shardUpstream}: ${message}` },
        502,
      );
    }
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

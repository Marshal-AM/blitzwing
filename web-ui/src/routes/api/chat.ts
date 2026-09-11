import path from "node:path";
import { fileURLToPath } from "node:url";
import { createFileRoute } from "@tanstack/react-router";
import { config as loadEnv } from "dotenv";
import { x402Client } from "@x402/core/client";
import { x402HTTPClient } from "@x402/core/http";
import { createClientHederaSigner, PrivateKey } from "@x402/hedera";
import { ExactHederaScheme } from "@x402/hedera/exact/client";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(__dirname, "../../../.env") });
loadEnv({ path: path.resolve(__dirname, "../../../../.env") });

const HEDERA_TESTNET = "hedera:testnet" as const;

type ChatRequestBody = {
  prompt?: string;
  model?: string;
  max_tokens?: number;
  stream?: boolean;
};

function parsePrivateKey(raw: string) {
  try {
    return PrivateKey.fromStringECDSA(raw);
  } catch {
    return PrivateKey.fromString(raw);
  }
}

function headerMap(res: Response): (name: string) => string | null {
  return (name) => res.headers.get(name);
}

function tokenizeForStream(text: string): string[] {
  return text.match(/\S+\s*|\s+/g) ?? [];
}

function sseLine(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

const SSE_HEADERS = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache",
  connection: "keep-alive",
  "x-accel-buffering": "no",
};

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: ChatRequestBody;
        try {
          body = (await request.json()) as ChatRequestBody;
        } catch {
          return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
            status: 400,
            headers: { "content-type": "application/json" },
          });
        }

        const prompt = (body.prompt || "").trim();
        const model = body.model || process.env.VITE_BLITZWING_MODEL || "bigscience/bloom-560m";
        const maxTokens = Math.max(1, Number(body.max_tokens || 24));
        const wantStream = body.stream !== false;

        if (!prompt) {
          return new Response(JSON.stringify({ error: "prompt is required" }), {
            status: 400,
            headers: { "content-type": "application/json" },
          });
        }

        const gatewayUrl = (
          process.env.X402_GATEWAY_URL ||
          process.env.VITE_X402_GATEWAY_URL ||
          "http://127.0.0.1:8000"
        ).replace(/\/$/, "");
        const privateKeyRaw = (
          process.env.HEDERA_PRIVATE_KEY ||
          process.env.PRIVATE_KEY ||
          ""
        ).trim();
        const hederaAccountId = (process.env.HEDERA_ACCOUNT_ID || "").trim();

        if (!privateKeyRaw || !hederaAccountId) {
          return new Response(
            JSON.stringify({
              error:
                "Server missing HEDERA_PRIVATE_KEY / HEDERA_ACCOUNT_ID for x402 payment",
            }),
            { status: 500, headers: { "content-type": "application/json" } },
          );
        }

        const key = parsePrivateKey(privateKeyRaw);
        const signer = createClientHederaSigner(hederaAccountId, key, {
          network: HEDERA_TESTNET,
        });
        const x402 = new x402HTTPClient(
          x402Client.fromConfig({
            schemes: [
              {
                network: HEDERA_TESTNET,
                client: new ExactHederaScheme(signer),
              },
            ],
            spendControls: false,
          }),
        );

        const url = `${gatewayUrl}/v1/chat/completions`;
        const gatewayBody = JSON.stringify({
          model,
          messages: [
            {
              role: "system",
              content:
                "You are a helpful assistant running on a distributed Petals swarm. Keep answers concise.",
            },
            { role: "user", content: prompt },
          ],
          max_tokens: maxTokens,
          temperature: 0.7,
          stream: false,
        });
        const gatewayInit: RequestInit = {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: gatewayBody,
        };

        if (!wantStream) {
          try {
            const res = await payOnceBlocking(x402, url, gatewayInit);
            const text = await res.text();
            let data: Record<string, unknown> = {};
            try {
              data = text ? JSON.parse(text) : {};
            } catch {
              return new Response(
                JSON.stringify({ error: text || `Gateway error (${res.status})` }),
                { status: res.status, headers: { "content-type": "application/json" } },
              );
            }
            if (!res.ok) {
              return new Response(JSON.stringify(data), {
                status: res.status,
                headers: { "content-type": "application/json" },
              });
            }
            const content =
              (data.choices as Array<{ message?: { content?: string } }> | undefined)?.[0]
                ?.message?.content ?? "";
            return new Response(JSON.stringify({ content, payment: data.blitzwing_payment }), {
              headers: { "content-type": "application/json" },
            });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return new Response(JSON.stringify({ error: message }), {
              status: 502,
              headers: { "content-type": "application/json" },
            });
          }
        }

        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          async start(controller) {
            const push = (payload: unknown) => {
              controller.enqueue(encoder.encode(sseLine(payload)));
            };

            try {
              push({ type: "phase", phase: "paying" });

              let res = await fetch(url, gatewayInit);
              if (res.status === 402) {
                const body402 = await res
                  .clone()
                  .json()
                  .catch(async () => res.clone().text());
                const paymentRequired = x402.getPaymentRequiredResponse(
                  headerMap(res),
                  body402,
                );
                const payload = await x402.createPaymentPayload(paymentRequired);
                const payHeaders = x402.encodePaymentSignatureHeader(payload);
                const headers = new Headers(gatewayInit.headers);
                for (const [k, v] of Object.entries(payHeaders)) {
                  headers.set(k, v);
                }
                push({ type: "phase", phase: "paying" });
                push({ type: "phase", phase: "routing" });
                res = await fetch(url, { ...gatewayInit, headers });
              } else {
                push({ type: "phase", phase: "routing" });
              }

              const text = await res.text();
              let data: Record<string, unknown> = {};
              try {
                data = text ? JSON.parse(text) : {};
              } catch {
                push({ type: "error", message: text || `Gateway error (${res.status})` });
                controller.close();
                return;
              }

              if (!res.ok) {
                const message =
                  typeof data.error === "string"
                    ? data.error
                    : JSON.stringify(data).slice(0, 400);
                push({ type: "error", message });
                controller.close();
                return;
              }

              const content =
                (data.choices as Array<{ message?: { content?: string } }> | undefined)?.[0]
                  ?.message?.content ?? "";
              const payment = data.blitzwing_payment;

              push({ type: "phase", phase: "streaming" });
              if (payment) {
                push({ type: "payment", payment });
              }

              const tokens = tokenizeForStream(String(content));
              for (const token of tokens) {
                push({ token });
                await new Promise((r) => setTimeout(r, 12));
              }
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              controller.close();
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              push({ type: "error", message });
              controller.close();
            }
          },
        });

        return new Response(stream, { headers: SSE_HEADERS });
      },
    },
  },
});

async function payOnceBlocking(
  x402: x402HTTPClient,
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const first = await fetch(url, init);
  if (first.status !== 402) return first;

  const body = await first
    .clone()
    .json()
    .catch(async () => first.clone().text());
  const paymentRequired = x402.getPaymentRequiredResponse(headerMap(first), body);
  const payload = await x402.createPaymentPayload(paymentRequired);
  const payHeaders = x402.encodePaymentSignatureHeader(payload);
  const headers = new Headers(init?.headers);
  for (const [k, v] of Object.entries(payHeaders)) {
    headers.set(k, v);
  }
  return fetch(url, { ...init, headers });
}

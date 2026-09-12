import path from "node:path";
import { fileURLToPath } from "node:url";
import { createFileRoute } from "@tanstack/react-router";
import { decodePaymentRequiredHeader } from "@x402/core/http";
import { config as loadEnv } from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(__dirname, "../../../../.env") });
loadEnv({ path: path.resolve(__dirname, "../../../../../.env") });

const GATEWAY_URL = (
  process.env.VITE_X402_GATEWAY_URL ||
  process.env.X402_GATEWAY_URL ||
  "http://34.9.229.188:8000"
).replace(/\/$/, "");

const FORWARD_REQUEST_HEADERS = [
  "content-type",
  "accept",
  "payment-signature",
  "PAYMENT-SIGNATURE",
  "x-payment",
  "X-PAYMENT",
];

const FORWARD_RESPONSE_HEADERS = [
  "content-type",
  "payment-response",
  "PAYMENT-RESPONSE",
  "x-payment-response",
  "X-PAYMENT-RESPONSE",
];

export const Route = createFileRoute("/api/x402/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const upstreamUrl = `${GATEWAY_URL}/v1/chat/completions`;
          const headers = new Headers();
          for (const name of FORWARD_REQUEST_HEADERS) {
            const value = request.headers.get(name);
            if (value) headers.set(name, value);
          }

          const upstream = await fetch(upstreamUrl, {
            method: "POST",
            headers,
            body: await request.arrayBuffer(),
          });

          if (upstream.status === 402) {
            const paymentHeader =
              upstream.headers.get("payment-required") ||
              upstream.headers.get("PAYMENT-REQUIRED");
            if (paymentHeader) {
              const paymentRequired = decodePaymentRequiredHeader(paymentHeader);
              return new Response(JSON.stringify(paymentRequired), {
                status: 402,
                headers: { "content-type": "application/json" },
              });
            }
          }

          const outHeaders = new Headers();
          for (const name of FORWARD_RESPONSE_HEADERS) {
            const value = upstream.headers.get(name);
            if (value) outHeaders.set(name, value);
          }
          if (!outHeaders.has("content-type")) {
            outHeaders.set(
              "content-type",
              upstream.headers.get("content-type") || "application/json",
            );
          }

          return new Response(await upstream.text(), {
            status: upstream.status,
            headers: outHeaders,
          });
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

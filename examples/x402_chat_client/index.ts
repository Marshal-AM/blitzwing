/**
 * Paying Blitzwing chat client using the official Hedera x402 SDK
 * (@x402/core + @x402/hedera) — same stack as x500-sdk payOnce.
 *
 * Repo-root .env:
 *   HEDERA_PRIVATE_KEY, HEDERA_ACCOUNT_ID   (consumer)
 *
 * Mother public URL must be the x402 gateway (packages/x402-gateway) with
 * X402_ENABLED=1 and COST_PER_LAYER_TINYBARS set.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { x402Client } from "@x402/core/client";
import { x402HTTPClient } from "@x402/core/http";
import { createClientHederaSigner, PrivateKey } from "@x402/hedera";
import { ExactHederaScheme } from "@x402/hedera/exact/client";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootEnv = path.resolve(__dirname, "../../.env");
config({ path: rootEnv });
config();

const HEDERA_TESTNET = "hedera:testnet" as const;

const privateKeyRaw = (
  process.env.HEDERA_PRIVATE_KEY ||
  process.env.PRIVATE_KEY ||
  ""
).trim();
const hederaAccountId = (process.env.HEDERA_ACCOUNT_ID || "").trim();
const baseURL = (
  process.env.RESOURCE_SERVER_URL ||
  process.env.BLITZWING_BASE_URL ||
  "http://127.0.0.1:8000"
).replace(/\/v1\/?$/, "");
const endpointPath = process.env.ENDPOINT_PATH || "/v1/chat/completions";
const model = process.env.BLITZWING_MODEL || "TinyLlama/TinyLlama-1.1B-Chat-v1.0";
const query =
  process.env.BLITZWING_QUERY || "Say hello in one short friendly sentence.";

if (!privateKeyRaw || !hederaAccountId) {
  console.error(
    "Missing HEDERA_PRIVATE_KEY / HEDERA_ACCOUNT_ID (consumer wallet in repo .env)",
  );
  process.exit(1);
}

function parsePrivateKey(raw: string): ReturnType<typeof PrivateKey.fromString> {
  // Prefer ECDSA (x402 Hedera live path); fall back to generic parse.
  try {
    return PrivateKey.fromStringECDSA(raw);
  } catch {
    return PrivateKey.fromString(raw);
  }
}

function headerMap(res: Response): (name: string) => string | null {
  return (name) => res.headers.get(name);
}

async function payOnce(
  x402: x402HTTPClient,
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const first = await fetch(url, init);
  if (first.status !== 402) {
    return first;
  }
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

async function main(): Promise<void> {
  const url = `${baseURL}${endpointPath}`;
  console.log(`resource : ${url}`);
  console.log(`payer    : ${hederaAccountId}`);
  console.log(`model    : ${model}`);
  console.log(`query    : ${query}`);

  const key = parsePrivateKey(privateKeyRaw);
  const signer = createClientHederaSigner(hederaAccountId, key, {
    network: HEDERA_TESTNET,
  });
  const x402 = new x402HTTPClient(
    new x402Client().register(HEDERA_TESTNET, new ExactHederaScheme(signer)),
  );

  const res = await payOnce(x402, url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content:
            "You are a helpful assistant running on a private Petals swarm. Keep answers concise.",
        },
        { role: "user", content: query },
      ],
      max_tokens: 64,
      temperature: 0.7,
      stream: false,
    }),
  });

  const text = await res.text();
  let data: unknown = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* keep raw */
  }

  console.log("---");
  console.log(`status: ${res.status}`);
  console.log(typeof data === "string" ? data : JSON.stringify(data, null, 2));

  const paymentHeader =
    res.headers.get("payment-response") ||
    res.headers.get("x-payment-response");
  if (paymentHeader) {
    console.log("--- payment-response ---");
    console.log(paymentHeader.slice(0, 500));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

import { x402Client } from "@x402/core/client";
import { x402HTTPClient } from "@x402/core/http";
import type { PaymentRequired } from "@x402/core/types";
import { ExactHederaScheme } from "@x402/hedera/exact/client";
import { API_CONFIG } from "@/config";
import { createWalletHederaSigner } from "@/lib/wallet/wallet-x402-signer";

const HEDERA_TESTNET = "hedera:testnet" as const;

/** Same-origin proxy — browsers cannot read cross-origin PAYMENT-REQUIRED headers. */
const X402_PROXY_URL = "/api/x402/chat";

function headerMap(res: Response): (name: string) => string | null {
  return (name) => res.headers.get(name);
}

function tokenizeForStream(text: string): string[] {
  return text.match(/\S+\s*|\s+/g) ?? [];
}

async function payOnce(
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

  let paymentRequired: PaymentRequired;
  if (
    body &&
    typeof body === "object" &&
    "x402Version" in body &&
    (body as PaymentRequired).x402Version === 2
  ) {
    paymentRequired = body as PaymentRequired;
  } else {
    paymentRequired = x402.getPaymentRequiredResponse(headerMap(first), body);
  }
  const payload = await x402.createPaymentPayload(paymentRequired);
  const payHeaders = x402.encodePaymentSignatureHeader(payload);
  const headers = new Headers(init?.headers);
  for (const [k, v] of Object.entries(payHeaders)) {
    headers.set(k, v);
  }
  return fetch(url, { ...init, headers });
}

export type PaidChatResult = {
  content: string;
  payment?: unknown;
};

export async function paidChatCompletion(
  accountId: string,
  prompt: string,
  options?: { model?: string; maxTokens?: number },
): Promise<PaidChatResult> {
  const model = options?.model ?? API_CONFIG.model;
  const maxTokens = options?.maxTokens ?? API_CONFIG.maxTokens;
  const url = X402_PROXY_URL;

  const signer = createWalletHederaSigner(accountId);
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

  const res = await payOnce(x402, url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: gatewayBody,
  });

  const text = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(text || `Gateway error (${res.status})`);
  }

  if (!res.ok) {
    const message =
      typeof data.error === "string" ? data.error : JSON.stringify(data).slice(0, 400);
    throw new Error(message);
  }

  const content =
    (data.choices as Array<{ message?: { content?: string } }> | undefined)?.[0]?.message
      ?.content ?? "";

  return {
    content: String(content),
    payment: data.blitzwing_payment,
  };
}

export function streamTokens(
  content: string,
  onToken: (token: string) => void,
  delayMs = 12,
): Promise<void> {
  const tokens = tokenizeForStream(content);
  return new Promise((resolve) => {
    let i = 0;
    const tick = () => {
      if (i >= tokens.length) {
        resolve();
        return;
      }
      onToken(tokens[i]!);
      i += 1;
      setTimeout(tick, delayMs);
    };
    tick();
  });
}

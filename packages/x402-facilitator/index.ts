/**
 * Blitzwing x402 facilitator — Exact HBAR on hedera:testnet.
 *
 * Endpoints (x402 facilitator HTTP API):
 *   GET  /health
 *   GET  /supported
 *   POST /verify
 *   POST /settle
 *
 * Env (repo-root .env or process env):
 *   FACILITATOR_ACCOUNT_ID=0.0.xxx          # fee payer
 *   FACILITATOR_PRIVATE_KEY=0x...           # ECDSA preferred
 *   HEDERA_NETWORK=hedera:testnet           # required exact value
 *   FACILITATOR_PORT=8791
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { config } from "dotenv";
import { x402Facilitator } from "@x402/core/facilitator";
import { ExactHederaScheme } from "@x402/hedera/exact/facilitator";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import {
  assertHbarExactRequirements,
  createLiveFacilitatorSigner,
  HBAR_ASSET,
  HEDERA_TESTNET,
} from "./hedera-signer.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "../../.env") });
config();

const rawNetwork = (process.env.HEDERA_NETWORK || HEDERA_TESTNET).trim();
const networkEnv =
  rawNetwork === "hedera-testnet" || rawNetwork === "testnet"
    ? HEDERA_TESTNET
    : rawNetwork;
if (networkEnv !== HEDERA_TESTNET) {
  console.error(
    `Facilitator refuses boot: HEDERA_NETWORK must be "${HEDERA_TESTNET}" (got ${JSON.stringify(rawNetwork)})`,
  );
  process.exit(1);
}

const accountId = (
  process.env.FACILITATOR_ACCOUNT_ID ||
  process.env.HEDERA_FACILITATOR_ACCOUNT_ID ||
  ""
).trim();
const privateKey = (
  process.env.FACILITATOR_PRIVATE_KEY ||
  process.env.HEDERA_FACILITATOR_PRIVATE_KEY ||
  ""
).trim();

if (!accountId || !/^0\.0\.\d+$/.test(accountId) || !privateKey) {
  console.error(
    "FACILITATOR_ACCOUNT_ID (0.0.xxx) and FACILITATOR_PRIVATE_KEY are required",
  );
  process.exit(1);
}

const port = Number(process.env.FACILITATOR_PORT || process.env.PORT || 8791);

const signer = createLiveFacilitatorSigner(accountId, privateKey);
const scheme = new ExactHederaScheme(signer, { aliasPolicy: "reject" });
const facilitator = new x402Facilitator().register(HEDERA_TESTNET, scheme);

facilitator.onBeforeVerify(async ({ requirements }) => {
  try {
    assertHbarExactRequirements({
      asset: requirements.asset,
      network: requirements.network,
    });
  } catch (err) {
    return {
      abort: true as const,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
});

facilitator.onBeforeSettle(async ({ requirements }) => {
  try {
    assertHbarExactRequirements({
      asset: requirements.asset,
      network: requirements.network,
    });
  } catch (err) {
    return {
      abort: true as const,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
});

const app = new Hono();

app.get("/health", (c) =>
  c.json({
    ok: true,
    service: "blitzwing-x402-facilitator",
    network: HEDERA_TESTNET,
    asset: HBAR_ASSET,
    scheme: "exact",
    facilitatorAccountId: accountId,
    port,
  }),
);

app.get("/supported", (c) => c.json(facilitator.getSupported()));

app.post("/verify", async (c) => {
  const body = (await c.req.json()) as {
    paymentPayload: PaymentPayload;
    paymentRequirements: PaymentRequirements;
  };
  try {
    assertHbarExactRequirements({
      asset: body.paymentRequirements?.asset,
      network: body.paymentRequirements?.network,
    });
  } catch (err) {
    return c.json(
      {
        isValid: false,
        invalidReason: "unsupported_asset_or_network",
        invalidMessage: err instanceof Error ? err.message : String(err),
      },
      400,
    );
  }
  const result = await facilitator.verify(
    body.paymentPayload,
    body.paymentRequirements,
  );
  return c.json(result);
});

app.post("/settle", async (c) => {
  const body = (await c.req.json()) as {
    paymentPayload: PaymentPayload;
    paymentRequirements: PaymentRequirements;
  };
  try {
    assertHbarExactRequirements({
      asset: body.paymentRequirements?.asset,
      network: body.paymentRequirements?.network,
    });
  } catch (err) {
    return c.json(
      {
        success: false,
        errorReason: "unsupported_asset_or_network",
        errorMessage: err instanceof Error ? err.message : String(err),
        transaction: "",
        network: body.paymentRequirements?.network ?? "",
      },
      400,
    );
  }
  const result = await facilitator.settle(
    body.paymentPayload,
    body.paymentRequirements,
  );
  return c.json(result);
});

serve({ fetch: app.fetch, port }, () => {
  console.log(
    `[blitzwing-x402-facilitator] listening on :${port} feePayer=${accountId} network=${HEDERA_TESTNET}`,
  );
});

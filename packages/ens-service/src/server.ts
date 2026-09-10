import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { ENS_CONFIG, SEPOLIA_CHAIN_ID } from "./config.js";
import {
  deactivateHost,
  operatorAddress,
  provisionHost,
  resolveHostRecord,
  updateHost,
} from "./client.js";
import { getEnsNameForHost } from "./state.js";
import { hostIdToEnsName } from "./records.js";

const app = new Hono();

app.get("/health", (c) =>
  c.json({
    status: "ok",
    parent: ENS_CONFIG.parentName,
    chainId: SEPOLIA_CHAIN_ID,
    operator: operatorAddress(),
  }),
);

app.post("/v1/hosts/provision", async (c) => {
  try {
    const body = await c.req.json();
    const hostId = String(body.hostId || "");
    if (!hostId) {
      return c.json({ error: "hostId required", code: "invalid_request", retryable: false }, 400);
    }

    const existing = getEnsNameForHost(hostId);
    if (existing) {
      const out = await updateHost({
        ensName: existing,
        hostId,
        hederaAccountId: body.hederaAccountId,
        blockIndices: body.blockIndices,
        layersHosted: body.layersHosted,
        model: body.model,
        role: body.role,
        status: body.status || "online",
      });
      return c.json({ ensName: existing, txHashes: out.txHashes, updated: true });
    }

    const out = await provisionHost({
      hostId,
      role: body.role || "contributor",
      hederaAccountId: body.hederaAccountId,
      blockIndices: body.blockIndices,
      layersHosted: Number(body.layersHosted || 0),
      model: body.model || "",
      status: body.status || "online",
    });
    return c.json(out);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("provision failed", message);
    return c.json({ error: message, code: "ens_provision_failed", retryable: true }, 500);
  }
});

app.post("/v1/hosts/update", async (c) => {
  try {
    const body = await c.req.json();
    const ensName = String(body.ensName || "");
    if (!ensName) {
      return c.json({ error: "ensName required", code: "invalid_request", retryable: false }, 400);
    }
    const out = await updateHost({
      ensName,
      hostId: body.hostId,
      hederaAccountId: body.hederaAccountId,
      blockIndices: body.blockIndices,
      layersHosted: body.layersHosted,
      model: body.model,
      role: body.role,
      status: body.status,
    });
    return c.json(out);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message, code: "ens_update_failed", retryable: true }, 500);
  }
});

app.post("/v1/hosts/deactivate", async (c) => {
  try {
    const body = await c.req.json();
    const ensName = String(body.ensName || "");
    if (!ensName) {
      return c.json({ error: "ensName required", code: "invalid_request", retryable: false }, 400);
    }
    const out = await deactivateHost(ensName);
    return c.json(out);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message, code: "ens_deactivate_failed", retryable: true }, 500);
  }
});

app.get("/v1/hosts/resolve", async (c) => {
  try {
    const name = c.req.query("name") || "";
    const hostId = c.req.query("hostId") || "";
    const ensName =
      name || (hostId ? getEnsNameForHost(hostId) || hostIdToEnsName(hostId, ENS_CONFIG.parentName) : "");
    if (!ensName) {
      return c.json({ error: "name or hostId required", code: "invalid_request" }, 400);
    }
    const record = await resolveHostRecord(ensName);
    if (!record) {
      return c.json({ ensName, record: null }, 404);
    }
    return c.json({ ensName, record });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message, code: "ens_resolve_failed", retryable: true }, 500);
  }
});

const port = ENS_CONFIG.port;
console.log(`ENS service listening on :${port} parent=${ENS_CONFIG.parentName}`);
serve({ fetch: app.fetch, port });

import type { PaymentReceipt } from "@/components/sim/types";

export function tinybarsToHbar(tinybars: number): string {
  const hbar = tinybars / 100_000_000;
  return hbar >= 0.01 ? hbar.toFixed(4) : hbar.toFixed(8);
}

export function parsePaymentReceipt(raw: unknown): PaymentReceipt | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  return {
    request_id: typeof p.request_id === "string" ? p.request_id : undefined,
    x402_tx_id: typeof p.x402_tx_id === "string" ? p.x402_tx_id : null,
    payout_tx_id: typeof p.payout_tx_id === "string" ? p.payout_tx_id : null,
    hcs_topic_id: typeof p.hcs_topic_id === "string" ? p.hcs_topic_id : null,
    hcs_sequence: typeof p.hcs_sequence === "string" ? p.hcs_sequence : null,
    cost_per_layer_tinybars:
      typeof p.cost_per_layer_tinybars === "number" ? p.cost_per_layer_tinybars : undefined,
    total_tinybars: typeof p.total_tinybars === "number" ? p.total_tinybars : undefined,
    hosts: Array.isArray(p.hosts)
      ? p.hosts.map((h) => {
          const row = h as Record<string, unknown>;
          return {
            host_id: String(row.host_id ?? ""),
            ens_name: typeof row.ens_name === "string" ? row.ens_name : null,
            hedera_account_id:
              typeof row.hedera_account_id === "string" ? row.hedera_account_id : null,
            layers: typeof row.layers === "number" ? row.layers : undefined,
            amount_tinybars:
              typeof row.amount_tinybars === "number" ? row.amount_tinybars : undefined,
          };
        })
      : [],
  };
}

const HEDERA_ENTITY_RE = /^0\.0\.\d+$/;

export function isHederaEntityId(value: string | null | undefined): boolean {
  return Boolean(value && HEDERA_ENTITY_RE.test(value.trim()));
}

/** Canonical Hedera tx id: `0.0.123@seconds.nanoseconds` (optional `/nonce` for child txs). */
function normalizeHederaTxId(txId: string): string {
  const trimmed = txId.trim();
  if (/^0\.0\.\d+@\d+\.\d+/.test(trimmed)) return trimmed;
  const dashMatch = trimmed.match(/^(0\.0\.\d+)-(\d+\.\d+(?:\/\d+)?)$/);
  if (dashMatch) return `${dashMatch[1]}@${dashMatch[2]}`;
  return trimmed;
}

export function hederaExplorerTx(txId: string | null | undefined): string | null {
  if (!txId?.trim()) return null;
  const normalized = normalizeHederaTxId(txId);
  if (!/^0\.0\.\d+@\d+\.\d+/.test(normalized)) return null;
  return `https://hashscan.io/testnet/transaction/${normalized}`;
}

export function hederaExplorerTopic(topicId: string | null | undefined): string | null {
  if (!isHederaEntityId(topicId)) return null;
  return `https://hashscan.io/testnet/topic/${topicId!.trim()}`;
}

export function hederaExplorerAccount(accountId: string | null | undefined): string | null {
  if (!isHederaEntityId(accountId)) return null;
  return `https://hashscan.io/testnet/account/${accountId!.trim()}`;
}

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

export function hederaExplorerTx(txId: string | null | undefined): string | null {
  if (!txId) return null;
  const normalized = txId.replace("@", "-");
  return `https://hashscan.io/testnet/transaction/${normalized}`;
}

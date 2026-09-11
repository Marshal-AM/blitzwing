import type { PaymentReceipt, Tone } from "./types";
import { hederaExplorerTx, tinybarsToHbar } from "@/lib/payment";

const TONE_TEXT: Record<Tone, string> = {
  cyan: "text-cyan",
  magenta: "text-accent",
  amber: "text-amber",
  lime: "text-lime",
  violet: "text-violet",
};

export function SettlementPanel({ payment }: { payment: PaymentReceipt | null }) {
  if (!payment) {
    return (
      <div className="panel rounded-xl px-4 py-3 font-mono text-[11px] text-muted-foreground/70">
        Hedera settlement appears here after a paid inference run completes.
      </div>
    );
  }

  const x402Link = hederaExplorerTx(payment.x402_tx_id);
  const payoutLink = hederaExplorerTx(payment.payout_tx_id);

  return (
    <div className="panel overflow-hidden rounded-xl">
      <div className="border-b border-hairline bg-surface-raised/60 px-4 py-2.5">
        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
          hedera settlement
        </span>
      </div>

      <div className="grid gap-px bg-hairline/60 font-mono text-[10.5px]">
        {[
          ["x402 escrow tx", payment.x402_tx_id, x402Link, "amber"],
          ["payout tx", payment.payout_tx_id, payoutLink, "lime"],
          ["hcs audit", payment.hcs_topic_id ? `${payment.hcs_topic_id}#${payment.hcs_sequence ?? "?"}` : null, null, "cyan"],
          [
            "total paid",
            payment.total_tinybars
              ? `${tinybarsToHbar(payment.total_tinybars)} HBAR (${payment.total_tinybars} tinybars)`
              : null,
            null,
            "violet",
          ],
        ].map(([label, value, link, tone]) =>
          value ? (
            <div key={String(label)} className="bg-surface px-4 py-2.5">
              <p className={`uppercase tracking-[0.14em] ${TONE_TEXT[tone as Tone]}`}>{label}</p>
              {link ? (
                <a
                  href={link}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-0.5 block truncate text-foreground hover:text-cyan"
                >
                  {value}
                </a>
              ) : (
                <p className="mt-0.5 truncate text-foreground">{value}</p>
              )}
            </div>
          ) : null,
        )}
      </div>

      {payment.hosts && payment.hosts.length > 0 ? (
        <div className="border-t border-hairline px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            per-host payouts
          </p>
          <div className="mt-2 flex flex-col gap-2">
            {payment.hosts.map((h) => (
              <div
                key={h.host_id}
                className="rounded border border-hairline bg-surface-sunken/50 px-3 py-2 font-mono text-[10.5px]"
              >
                <p className="text-violet">{h.ens_name || h.host_id}</p>
                <p className="text-muted-foreground">
                  {h.layers ?? "?"} layers → {h.hedera_account_id || "?"}
                </p>
                {h.amount_tinybars ? (
                  <p className="text-lime">
                    +{tinybarsToHbar(h.amount_tinybars)} HBAR
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

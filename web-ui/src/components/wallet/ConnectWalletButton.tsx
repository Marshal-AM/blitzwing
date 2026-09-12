import { hederaExplorerAccount } from "@/lib/payment";
import { useWallet } from "./WalletProvider";

export function ConnectWalletButton() {
  const { accountId, connecting, connect, disconnect } = useWallet();

  if (accountId) {
    const explorerHref = hederaExplorerAccount(accountId);
    return (
      <div className="flex items-center gap-2">
        <div className="panel rounded-lg px-3 py-2 font-mono text-[10px] text-foreground">
          {explorerHref ? (
            <a
              href={explorerHref}
              target="_blank"
              rel="noreferrer"
              className="max-w-[140px] truncate text-cyan underline hover:text-cyan/80 sm:max-w-none"
            >
              {accountId}
            </a>
          ) : (
            <span className="truncate">{accountId}</span>
          )}
        </div>
        <button
          type="button"
          onClick={() => void disconnect()}
          className="rounded-md border border-hairline px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:border-destructive/50 hover:text-destructive"
        >
          disconnect
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      disabled={connecting}
      onClick={() => void connect().catch(() => {})}
      className="rounded-md bg-accent px-3.5 py-2 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-accent-foreground transition-colors hover:bg-accent/90 disabled:opacity-50"
    >
      {connecting ? "connecting…" : "connect wallet"}
    </button>
  );
}

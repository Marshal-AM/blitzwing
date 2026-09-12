import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { WalletContext, type WalletContextValue } from "./wallet-context";

export function WalletProvider({ children }: { children: ReactNode }) {
  const [accountId, setAccountId] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { restoreWalletSession } = await import("@/lib/wallet/hedera-wallet");
        const restored = await restoreWalletSession();
        if (!cancelled && restored) setAccountId(restored);
      } catch (e) {
        console.error("[wallet] session restore error", e);
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const connect = useCallback(async () => {
    setConnecting(true);
    try {
      const { connectWallet } = await import("@/lib/wallet/hedera-wallet");
      const id = await connectWallet();
      setAccountId(id);
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    const { disconnectWallet } = await import("@/lib/wallet/hedera-wallet");
    await disconnectWallet();
    setAccountId(null);
  }, []);

  const value = useMemo<WalletContextValue>(
    () => ({ accountId, connecting, ready, connect, disconnect }),
    [accountId, connecting, ready, connect, disconnect],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

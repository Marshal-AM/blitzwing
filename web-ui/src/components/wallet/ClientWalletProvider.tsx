import { useEffect, useState, type ReactNode } from "react";
import { stubWalletContext, WalletContext } from "./wallet-context";

/**
 * Defers wallet bundle (Reown / HashPack) to the browser so SSR stays fast.
 * Provides a stub context until the real WalletProvider module loads.
 */
export function ClientWalletProvider({ children }: { children: ReactNode }) {
  const [WalletProvider, setWalletProvider] = useState<
    null | ((props: { children: ReactNode }) => JSX.Element)
  >(null);

  useEffect(() => {
    import("./WalletProvider").then((mod) => {
      setWalletProvider(() => mod.WalletProvider);
    });
  }, []);

  if (!WalletProvider) {
    return (
      <WalletContext.Provider value={stubWalletContext}>{children}</WalletContext.Provider>
    );
  }

  return <WalletProvider>{children}</WalletProvider>;
}

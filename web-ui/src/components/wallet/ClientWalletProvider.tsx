import { useEffect, useState, type ReactNode } from "react";

/**
 * Defers wallet bundle (Reown / HashPack) to the browser so SSR stays fast.
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
    return <>{children}</>;
  }

  return <WalletProvider>{children}</WalletProvider>;
}

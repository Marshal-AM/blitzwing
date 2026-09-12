import { createContext, useContext } from "react";

export interface WalletContextValue {
  accountId: string | null;
  connecting: boolean;
  ready: boolean;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
}

export const WalletContext = createContext<WalletContextValue | null>(null);

/** Used while the wallet bundle loads on the client. */
export const stubWalletContext: WalletContextValue = {
  accountId: null,
  connecting: false,
  ready: false,
  connect: async () => {},
  disconnect: async () => {},
};

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within WalletProvider");
  return ctx;
}

// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  // Lovable defaults to cloudflare-module; Vercel needs the vercel preset so static
  // assets (/assets/*.js) and the SSR handler deploy as one consistent Build Output.
  nitro: {
    preset: "vercel",
    output: {
      dir: ".vercel/output",
      serverDir: ".vercel/output/functions/__server.func",
      publicDir: ".vercel/output/static",
    },
  },
  vite: {
    resolve: {
      dedupe: ["@hiero-ledger/sdk", "@hiero-ledger/proto"],
    },
    ssr: {
      noExternal: [
        "@hashgraph/hedera-wallet-connect",
        "@hiero-ledger/sdk",
        "@reown/appkit",
        "@walletconnect/modal",
        "@walletconnect/universal-provider",
      ],
    },
    optimizeDeps: {
      include: ["@hashgraph/hedera-wallet-connect"],
    },
  },
});

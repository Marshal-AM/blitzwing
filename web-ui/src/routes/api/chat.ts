import { createFileRoute } from "@tanstack/react-router";

/** Legacy server route — x402 payments now happen client-side via HashPack. */
export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async () => {
        return new Response(
          JSON.stringify({
            error:
              "Server-side x402 signing is disabled. Connect HashPack in the web UI and run inference from the browser.",
          }),
          { status: 410, headers: { "content-type": "application/json" } },
        );
      },
    },
  },
});

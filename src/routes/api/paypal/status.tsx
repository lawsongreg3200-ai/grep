// GET /api/paypal/status — what the pricing page honestly shows about checkout
// readiness. Probes the sandbox OAuth credentials (cached) and the lazily-created
// Watchlist plan.

import { createFileRoute } from "@tanstack/react-router";
import { paypalStatus } from "~/lib/paypal";

export const Route = createFileRoute("/api/paypal/status")({
  server: {
    handlers: {
      GET: async () => {
        return Response.json(await paypalStatus());
      },
    },
  },
});
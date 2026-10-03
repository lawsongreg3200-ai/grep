// GET /api/paypal/orders — lead-only record list, read inline from the orders
// JSON directory (no auth for now — it only exposes order/subscription records).

import { createFileRoute } from "@tanstack/react-router";
import { listRecords, TEST_MODE } from "~/lib/paypal";

export const Route = createFileRoute("/api/paypal/orders")({
  server: {
    handlers: {
      GET: async () => {
        return Response.json({ testMode: TEST_MODE, records: listRecords() });
      },
    },
  },
});
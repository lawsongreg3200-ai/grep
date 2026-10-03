// GET /api/credits — deep-lookup credit balance for the current visitor
// (cookie + IP identity, same scheme as the free report quota). The report
// page uses this to decide between "Run deep lookup" and "Get a credit".
import { createFileRoute } from "@tanstack/react-router";
import { getCreditBalance } from "~/lib/credits";

export const Route = createFileRoute("/api/credits")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { credits } = getCreditBalance(request);
        return Response.json({ credits });
      },
    },
  },
});
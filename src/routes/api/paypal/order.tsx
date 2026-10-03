// POST /api/paypal/order — create a $10.00 one-off "Report extras" order via
// PayPal Orders v2. The amount is FIXED server-side; the client only asks for a
// tier. The result is stored under /home/team/shared/data/orders/ before it is
// returned, so every created order leaves an audit trail.

import { createFileRoute } from "@tanstack/react-router";
import { createReportExtrasOrder, TIERS } from "~/lib/paypal";

export const Route = createFileRoute("/api/paypal/order")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: { tier?: unknown } = {};
        try {
          body = (await request.json()) as { tier?: unknown };
        } catch {
          // no body — treat as default tier
        }
        if (body.tier !== undefined && body.tier !== "report-extras") {
          return Response.json(
            { error: "Only the report-extras tier is available for one-off orders." },
            { status: 400 }
          );
        }
        try {
          const record = await createReportExtrasOrder();
          return Response.json({
            orderId: record.orderId,
            tier: record.tier,
            amount: `${record.amount} ${record.currency}`,
            status: record.status,
            label: TIERS["report-extras"].label,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : "PayPal order creation failed.";
          return Response.json({ error: message }, { status: 502 });
        }
      },
    },
  },
});
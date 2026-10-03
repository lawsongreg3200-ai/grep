// POST /api/paypal/subscription — create a $19/mo Watchlist subscription
// (server-side; the Watchlist Product + Billing Plan are created lazily and
// cached in /home/team/shared/data/paypal-plan.json). With body
// { action: "record", subscriptionId } it instead fetches and stores the REAL
// state of an already-created subscription (used after SDK approval) — statuses
// always come from PayPal's API, never invented.

import { createFileRoute } from "@tanstack/react-router";
import { createWatchlistSubscription, recordSubscription } from "~/lib/paypal";

const SUB_ID_RE = /^[A-Za-z0-9-_]{6,40}$/;

export const Route = createFileRoute("/api/paypal/subscription")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: { action?: unknown; subscriptionId?: unknown } = {};
        try {
          body = (await request.json()) as { action?: unknown; subscriptionId?: unknown };
        } catch {
          // no body — plain creation
        }
        try {
          if (body.action === "record") {
            const subscriptionId =
              typeof body.subscriptionId === "string" ? body.subscriptionId.trim() : "";
            if (!SUB_ID_RE.test(subscriptionId)) {
              return Response.json({ error: "Invalid subscription id." }, { status: 400 });
            }
            const record = await recordSubscription(subscriptionId);
            return Response.json({
              subscriptionId: record.subscriptionId,
              status: record.status,
              payerEmail: record.payerEmail ?? null,
            });
          }
          const record = await createWatchlistSubscription();
          const approve =
            record.status === "APPROVAL_PENDING"
              ? `https://www.paypal.com/webapps/billing/subscriptions?ba_token=${record.subscriptionId}`
              : null;
          return Response.json({
            subscriptionId: record.subscriptionId,
            status: record.status,
            amount: `${record.amount} ${record.currency}`,
            interval: record.interval,
            approveUrl: approve,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : "PayPal subscription creation failed.";
          return Response.json({ error: message }, { status: 502 });
        }
      },
    },
  },
});
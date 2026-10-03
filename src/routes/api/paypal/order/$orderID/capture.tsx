// POST /api/paypal/order/$orderID/capture — server-side capture of an approved
// order. The outcome shown to the user comes from PayPal's real API response; a
// failed capture returns an honest error (502) and is recorded as FAILED with the
// reason, so nothing is ever reported as paid unless capture actually completed.

import { createFileRoute } from "@tanstack/react-router";
import { captureOrder, writeRecord } from "~/lib/paypal";
import { grantCreditForOrder, identityKey } from "~/lib/credits";

const ORDER_ID_RE = /^[A-Za-z0-9]{6,40}$/;

export const Route = createFileRoute("/api/paypal/order/$orderID/capture")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const orderId = (params.orderID ?? "").trim();
        if (!ORDER_ID_RE.test(orderId)) {
          return Response.json({ error: "Invalid order id." }, { status: 400 });
        }
        try {
          const record = await captureOrder(orderId);
          // The $10 tier's deliverable: a COMPLETED capture grants the buying
          // identity one deep-lookup credit. Idempotent per order id inside
          // grantCreditForOrder, so re-capturing can never mint two credits.
          if (record.captureStatus === "COMPLETED") {
            grantCreditForOrder(identityKey(request), orderId, {
              note: `granted on capture ${String(record.captureId ?? "")} of a ${record.tier} order`,
            });
          }
          return Response.json({
            orderId: record.orderId,
            status: record.status,
            captureStatus: record.captureStatus ?? null,
            captureId: record.captureId ?? null,
            payerEmail: record.payerEmail ?? null,
            amount: record.captureStatus === "COMPLETED" ? `${record.amount} ${record.currency}` : null,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : "PayPal capture failed.";
          try {
            writeRecord({
              kind: "order",
              orderId,
              refId: `inc-${orderId}`,
              tier: "report-extras",
              label: "Report extras \u2014 PDF + deep-lookup credit",
              amount: "10.00",
              currency: "USD",
              status: "FAILED",
              error: message,
              createdAt: new Date().toISOString(),
            });
          } catch {
            // audit write is best-effort; the error below is what matters
          }
          return Response.json({ error: message }, { status: 502 });
        }
      },
    },
  },
});

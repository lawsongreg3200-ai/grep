// POST /api/deepscan — run a DEEP lookup (the $10 tier feature) on a URL.
//
// Unlike POST /api/scan (which consumes the visitor's free report quota), this
// route is paid for by a deep-lookup credit: it checks the visitor's credit
// ledger, consumes exactly 1 credit, and only then starts the scan. With 0
// credits it returns 402 with an honest message — the report page routes that
// to /pricing instead of nagging. The scan itself runs through startScan with
// deep: true, so progress polling is the same /api/scan/$id/status endpoint.
import { createFileRoute } from "@tanstack/react-router";
import { startScan } from "~/lib/scanner";
import { consumeCredit, identityKey } from "~/lib/credits";

export const Route = createFileRoute("/api/deepscan")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: { url?: unknown };
        try {
          body = (await request.json()) as { url?: unknown };
        } catch {
          return Response.json({ error: "Send a JSON body with a `url` field." }, { status: 400 });
        }
        const rawUrl = typeof body.url === "string" ? body.url.trim() : "";
        if (!rawUrl) return Response.json({ error: "Enter a URL to scan." }, { status: 400 });
        if (!/^https?:\/\/.+\..+/i.test(rawUrl) && !/^[a-z0-9.-]+\.[a-z]{2,}/i.test(rawUrl)) {
          return Response.json(
            { error: "That doesn't look like a valid URL. Try something like https://example.com." },
            { status: 400 }
          );
        }

        const key = identityKey(request);
        const spent = consumeCredit(key, { targetUrl: rawUrl });
        if (!spent.ok) {
          return Response.json(
            {
              error: spent.reason,
              message:
                "The $10 tier (test mode) includes one deep-lookup credit. Every existing report stays fully visible — nothing is ever hidden.",
            },
            { status: 402 }
          );
        }

        const { id } = startScan(rawUrl, { deep: true });
        return Response.json({ id, deep: true, credits: spent.credits }, { status: 202 });
      },
    },
  },
});
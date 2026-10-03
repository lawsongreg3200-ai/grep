// /api/scan/$ — owns BOTH scan-start (POST) and scan-progress (GET) on a single
// route template. This router resolves /api/scan (no suffix) to this splat route
// with an empty splat rather than to a sibling static /api/scan route, so a
// separate static route's handler never fires (it served the page HTML instead
// of JSON). Keeping both methods on one template removes that shadowing.
//
// POST /api/scan            → 202 { id } (scan runs in the background)
// GET  /api/scan/$id/status → real progress; falls back to stored report so a
//                             client always resolves, even after a restart.
// Free tier: 1 full report per visitor, lifetime. After that, new scan attempts
// get the honest notice — never a paywall teaser, never blocked access to
// existing reports.

import { createFileRoute } from "@tanstack/react-router";
import { getJob, startScan } from "~/lib/scanner";
import { storage } from "~/lib/store";
import { checkAndConsume, cookieHeader, LIMIT_MESSAGE } from "~/lib/rate";

export const Route = createFileRoute("/api/scan/$")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const splat = (params._splat ?? "").trim();
        if (splat !== "") {
          return Response.json({ error: "Invalid scan path." }, { status: 400 });
        }

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

        const decision = checkAndConsume(request);
        if (!decision.allowed) {
          return Response.json(
            {
              error: decision.reason,
              message: `${LIMIT_MESSAGE} Any report already on the site stays open and fully visible — nothing is ever hidden.`,
            },
            { status: 429 }
          );
        }

        const { id } = startScan(rawUrl);
        const headers: Record<string, string> = {};
        if (decision.cookieValue) headers["Set-Cookie"] = cookieHeader(decision.cookieValue);
        return Response.json({ id, remaining: decision.remaining }, { status: 202, headers });
      },

      GET: async ({ params }) => {
        const splat = (params._splat ?? "").trim();
        const m = /^([a-z0-9-]{6,64})\/status$/.exec(splat);
        if (!m) {
          return Response.json({ status: "error", error: "Invalid scan id." }, { status: 400 });
        }
        const id = m[1];

        const job = getJob(id);
        if (job) {
          return Response.json(job);
        }

        // Job no longer in memory (server restarted or finished long ago):
        // fall back to the stored report so clients always resolve.
        const record = await storage.loadReport(id);
        if (record) {
          return Response.json({ id, status: "complete", step: "Report ready", progress: 1 });
        }
        return Response.json({ status: "error", error: "Unknown scan id." }, { status: 404 });
      },
    },
  },
});
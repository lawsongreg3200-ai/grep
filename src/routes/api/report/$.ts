// GET /api/report/$id — the full report JSON (mirrors the public /r/$id page).
// Splat route: params._splat is the report id.

import { createFileRoute } from "@tanstack/react-router";
import { storage } from "~/lib/store";

export const Route = createFileRoute("/api/report/$")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const id = (params._splat ?? "").trim();
        if (!/^[a-z0-9-]{6,64}$/.test(id)) {
          return Response.json({ error: "Invalid report id." }, { status: 400 });
        }
        const record = await storage.loadReport(id);
        if (!record) {
          return Response.json({ error: "Report not found." }, { status: 404 });
        }
        return Response.json(record.report);
      },
    },
  },
});
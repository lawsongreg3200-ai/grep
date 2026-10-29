/**
 * Robo Deebo — the public HTTP surface + the email watch pass.
 *
 * THIS is the gap the site has today: `src/lib/server.ts` is a set of
 * `createServerFn` RPC handlers, callable only from the page that shipped them.
 * Nothing outside the browser can call the chat or trigger the watcher.
 *
 * Every route below requires the shared secret header `X-Deebo-Key`, compared
 * against the Convex deployment env var `DEEBO_API_KEY`. Missing/wrong key ⇒
 * 401. If the env var itself is unset we fail closed (401), never open.
 *
 * Routes are registered on the router built in this file; `convex/http.ts`
 * re-exports it, which is the file Convex actually looks for.
 */
import { httpRouter } from "convex/server";
import { v } from "convex/values";
import { httpAction, internalMutation } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { sealSecret } from "./lib/secrets";

/* ------------------------------------------------------------------ */
/* Auth — shared secret, fail closed                                   */
/* ------------------------------------------------------------------ */

/** Length-independent compare, so a wrong key leaks nothing by timing. */
function safeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length === b.length ? 0 : 1;
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

function authorized(req: Request): boolean {
  const expected = process.env.DEEBO_API_KEY;
  if (!expected) return false; // no key configured ⇒ nothing is open
  const provided = req.headers.get("x-deebo-key");
  if (!provided) return false;
  return safeEqual(provided, expected);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

const unauthorized = () =>
  json({ ok: false, error: "unauthorized", detail: "missing or wrong X-Deebo-Key header" }, 401);

const badRequest = (detail: string) => json({ ok: false, error: "bad_request", detail }, 400);

type Handler = (ctx: ActionCtx, req: Request) => Promise<Response>;

/** Wraps a handler with the key check and a JSON error path. */
function guarded(fn: Handler) {
  return httpAction(async (ctx, req) => {
    if (!authorized(req)) return unauthorized();
    try {
      return await fn(ctx, req);
    } catch (err) {
      // Never echo internals (or secrets) back to a caller.
      console.error("deebo http error:", err);
      return json({ ok: false, error: "internal_error" }, 500);
    }
  });
}

/* ------------------------------------------------------------------ */
/* The watch pass — the whole reason we want Convex                    */
/* ------------------------------------------------------------------ */

/**
 * One watch pass: walk the enabled email connections, fetch new mail, score it.
 *
 * Today it does everything EXCEPT the actual scan, and says so in the data it
 * writes (one `scans` row with verdict "unscored"). It is driven two ways:
 *   - `convex/crons.ts` → every 5 minutes
 *   - `POST /watch/run` → on demand
 *
 * ── TODO(port) ──────────────────────────────────────────────────────────
 * The real pipeline lives in the site today and has to be ported into this
 * deployment:
 *   1. `src/lib/imap.ts` → `runEmailSync()`: IMAP fetch (imapflow) of new mail.
 *      imapflow needs real sockets, so the pass becomes an `action` with
 *      `"use node"` and the DB writes stay in a mutation like this one.
 *   2. `src/lib/phishing.ts` → `scoreEmail(parsed)`: score + band + explanation.
 *   3. `src/lib/urlcheck.ts` → Google Safe Browsing on each link.
 *   4. Per message: `ctx.db.insert("scans", { messageId, from, subject,
 *      verdict, score, reasons, links, createdAt })`, deduped on `by_message_id`
 *      (same rule as SQLite: Message-ID is the identity).
 * Then `scanned` / `flagged` become real counts instead of 0.
 * ────────────────────────────────────────────────────────────────────────
 */
export const runWatchPass = internalMutation({
  args: { source: v.union(v.literal("cron"), v.literal("http"), v.literal("manual")) },
  returns: v.object({ ok: v.boolean(), scanned: v.number(), flagged: v.number() }),
  handler: async (ctx, args) => {
    const now = Date.now();
    const watches = await ctx.db
      .query("watches")
      .withIndex("by_enabled", (q) => q.eq("enabled", true))
      .collect();

    // TODO(port): fetch + score each watch's mail here (see block above).
    for (const watch of watches) {
      await ctx.db.patch(watch._id, { lastRunAt: now, lastRunOk: true, lastError: undefined });
    }

    const scanned = 0;
    const flagged = 0;

    // Record that a pass ran. "unscored" is the honest verdict: no message was
    // fetched and nothing was scored — this row must never read as "all clear".
    await ctx.db.insert("scans", {
      messageId: "",
      from: "",
      subject: `watch pass (${args.source}) — no messages fetched`,
      verdict: "unscored",
      score: 0,
      reasons: [
        "IMAP + phishing pipeline not ported into this deployment yet",
        `${watches.length} enabled connection(s) configured`,
      ],
      links: [],
      createdAt: now,
    });

    return { ok: true, scanned, flagged };
  },
});

/** Stores (or updates) a user's email connection. The app password is sealed
 *  before it reaches the table. Not exposed over HTTP yet — the site's
 *  `saveConnection` server fn is still the writer, and this is its landing spot. */
export const saveWatch = internalMutation({
  args: {
    userId: v.id("users"),
    provider: v.union(v.literal("gmail"), v.literal("outlook"), v.literal("other")),
    email: v.string(),
    appPassword: v.string(),
    enabled: v.optional(v.boolean()),
  },
  returns: v.id("watches"),
  handler: async (ctx, args) => {
    const sealed = await sealSecret(args.appPassword);
    const existing = await ctx.db
      .query("watches")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        provider: args.provider,
        email: args.email,
        secretCiphertext: sealed.secretCiphertext,
        secretIv: sealed.secretIv,
        enabled: args.enabled ?? existing.enabled,
      });
      return existing._id;
    }
    return await ctx.db.insert("watches", {
      userId: args.userId,
      provider: args.provider,
      email: args.email,
      secretCiphertext: sealed.secretCiphertext,
      secretIv: sealed.secretIv,
      enabled: args.enabled ?? true,
      createdAt: Date.now(),
    });
  },
});

/* ------------------------------------------------------------------ */
/* Public REST surface                                                 */
/* ------------------------------------------------------------------ */

/** GET /health → { ok, service, time } */
const health = guarded(async () =>
  json({ ok: true, service: "robo-deebo", time: new Date().toISOString() }),
);

/** POST /chat { sessionId, message } → { ok, sessionId, reply } */
const chat = guarded(async (ctx, req) => {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("body must be JSON: { sessionId, message }");
  }
  const { sessionId, message } = (body ?? {}) as { sessionId?: unknown; message?: unknown };
  if (typeof sessionId !== "string" || !sessionId.trim()) {
    return badRequest("sessionId must be a non-empty string");
  }
  if (typeof message !== "string" || !message.trim()) {
    return badRequest("message must be a non-empty string");
  }

  // The reply comes from the internal seam in convex/chat.ts — replace
  // `replyFor` there with the ELITE responder and this endpoint upgrades.
  const turn = await ctx.runMutation(internal.chat.recordTurn, {
    sessionId,
    content: message,
  });
  return json({ ok: true, sessionId: turn.sessionId, reply: turn.reply });
});

/** POST /watch/run → { ok, scanned, flagged } */
const watchRun = guarded(async (ctx) => {
  const result = await ctx.runMutation(internal.watch.runWatchPass, { source: "http" });
  return json(result);
});

const router = httpRouter();

router.route({ path: "/health", method: "GET", handler: health });
router.route({ path: "/chat", method: "POST", handler: chat });
router.route({ path: "/watch/run", method: "POST", handler: watchRun });

export { router as deeboRouter };

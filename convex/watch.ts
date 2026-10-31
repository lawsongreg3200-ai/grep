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
import {
  hasScorableContent,
  reasonsFor,
  scoreEmail,
  verdictForBand,
  type ParsedEmail,
} from "./lib/phishing";

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
 * One message handed to the pass. Shaped to match `ParsedEmail` in
 * `convex/lib/phishing.ts` so scoring is a straight call, and to match the
 * `scans` columns so the write is a straight insert.
 */
const messageInput = v.object({
  messageId: v.optional(v.string()), // RFC822 Message-ID — the identity/dedupe key
  from: v.string(), // display form, "Name <addr@domain>"
  fromDomain: v.optional(v.string()),
  replyTo: v.optional(v.string()),
  subject: v.string(),
  body: v.string(),
  links: v.optional(v.array(v.string())),
  attachments: v.optional(v.array(v.string())),
});

/**
 * One watch pass: walk the enabled email connections, score every message it
 * is given, and write a REAL verdict per message.
 *
 * Driven two ways:
 *   - `convex/crons.ts` → every 5 minutes (no messages: IMAP not ported yet)
 *   - `POST /watch/run` → on demand
 *
 * HONESTY RULE (do not break this): a `scans` row may only read `safe` when a
 * message was actually scored and came back Low. "unscored" means "nothing was
 * looked at" and must never be displayed as an all-clear.
 *
 * ── TODO(port): IMAP fetch ─────────────────────────────────────────────
 * Messages currently arrive via `args.messages` — the scorer is done, the
 * fetching is not. Porting `src/lib/imap.ts` → `runEmailSync()` needs the
 * owner's real email connection (Gmail app password / API-MCP), which we do
 * not have yet. When it lands, `runWatchPass` becomes an `action` with
 * `"use node"` (imapflow needs real sockets) that fetches, then calls this
 * mutation with the parsed messages — the scoring and DB writes below stay
 * exactly as they are.
 * ───────────────────────────────────────────────────────────────────────
 *
 * ── TODO(port): URL reputation ────────────────────────────────────────
 * `src/lib/urlcheck.ts` (Google Safe Browsing) is NOT ported. It needs the
 * deployment env var `SAFEBROWSING_API_KEY`, which we cannot set from this
 * session (the deploy key has no env-var permission). Link scoring today is
 * heuristic-only (see `convex/lib/phishing.ts` signals 1–3).
 * ───────────────────────────────────────────────────────────────────────
 */
export const runWatchPass = internalMutation({
  args: {
    source: v.union(v.literal("cron"), v.literal("http"), v.literal("manual")),
    /** Messages to score. Absent/empty means nothing was fetched this pass. */
    messages: v.optional(v.array(messageInput)),
  },
  returns: v.object({
    ok: v.boolean(),
    scanned: v.number(),
    flagged: v.number(),
    unscored: v.number(),
  }),
  handler: async (ctx, args) => {
    const now = Date.now();
    const watches = await ctx.db
      .query("watches")
      .withIndex("by_enabled", (q) => q.eq("enabled", true))
      .collect();

    // TODO(port): fetch each watch's mail here — see the IMAP TODO above.
    for (const watch of watches) {
      await ctx.db.patch(watch._id, { lastRunAt: now, lastRunOk: true, lastError: undefined });
    }

    const messages = args.messages ?? [];
    let scanned = 0;
    let flagged = 0;
    let unscored = 0;

    for (const message of messages) {
      const parsed: ParsedEmail = {
        id: message.messageId ?? "",
        from: message.from,
        fromDomain: message.fromDomain,
        replyTo: message.replyTo,
        subject: message.subject,
        body: message.body,
        links: message.links,
        attachments: message.attachments,
      };

      // Same identity rule as SQLite: Message-ID is the identity. Already-scanned
      // messages are skipped rather than re-scored, so a 5-minute cron cannot
      // inflate the history.
      if (parsed.id) {
        const seen = await ctx.db
          .query("scans")
          .withIndex("by_message_id", (q) => q.eq("messageId", parsed.id))
          .first();
        if (seen) continue;
      }

      const links = message.links ?? [];

      // CASE 1 — nothing to score. Write "unscored", NEVER "safe": we did not
      // look at content, so we have no basis to call this mail clean.
      if (!hasScorableContent(parsed)) {
        unscored++;
        await ctx.db.insert("scans", {
          messageId: parsed.id,
          from: parsed.from,
          subject: parsed.subject || "(no subject)",
          verdict: "unscored",
          score: 0,
          reasons: [
            "No message content to score (empty subject, body, links and attachments) — this is NOT an all-clear.",
            `Pass source: ${args.source}.`,
          ],
          links,
          createdAt: now,
        });
        continue;
      }

      // CASE 2 — real content, so run the ported heuristics and write the
      // verdict they actually produce.
      const result = scoreEmail(parsed);
      const verdict = verdictForBand(result.band);
      await ctx.db.insert("scans", {
        messageId: parsed.id,
        from: parsed.from,
        subject: parsed.subject || "(no subject)",
        verdict,
        score: result.score,
        reasons: reasonsFor(result),
        links,
        createdAt: now,
      });
      scanned++;
      if (verdict === "phish" || verdict === "suspect") flagged++;
    }

    // CASE 3 — the pass ran but was handed no messages at all (today: the cron
    // and POST /watch/run, because IMAP is not ported). Record that a pass ran
    // with verdict "unscored" so the history shows the gap honestly.
    if (messages.length === 0) {
      await ctx.db.insert("scans", {
        messageId: "",
        from: "",
        subject: `watch pass (${args.source}) — no messages fetched`,
        verdict: "unscored",
        score: 0,
        reasons: [
          "No messages were fetched: live IMAP is not ported yet (needs the owner's real email connection). This pass did NOT look at any mail — it is not an all-clear.",
          "Phishing scoring IS ported (convex/lib/phishing.ts) and runs on any message handed to this pass.",
          `${watches.length} enabled connection(s) configured`,
        ],
        links: [],
        createdAt: now,
      });
    }

    return { ok: true, scanned, flagged, unscored };
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

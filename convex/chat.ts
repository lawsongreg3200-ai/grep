/**
 * Robo Deebo — chat transcript (Convex).
 *
 * Everything here is `internal*`: these functions are NOT reachable from a
 * browser. The only public door is the HTTP action in `convex/watch.ts`, which
 * checks the `X-Deebo-Key` shared secret before it calls in. When real client
 * auth lands, a public query can be added on top of `transcript` — until then
 * the internal-only rule keeps the deployment from being an open write API.
 */
import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

const MAX_CONTENT = 8_000; // hard ceiling so one caller can't wedge a session
const MAX_TRANSCRIPT = 200;

/**
 * Deterministic placeholder responder.
 *
 * ── SEAM ────────────────────────────────────────────────────────────────
 * This is where the real ROBO DEEBO ELITE responder drops in. Today the live
 * site answers in `src/components/DeeboChat.tsx` (`eliteReply()`: Executive
 * Summary / Facts / Analysis / Risks / Recommendations / Confidence /
 * Assumptions, with the "Insufficient evidence for a reliable conclusion."
 * failsafe). That function is client-side and model-free — port it here, keep
 * the same output shape, and every caller of `POST /chat` upgrades at once.
 * Nothing else in this file has to change when that happens.
 * ────────────────────────────────────────────────────────────────────────
 */
export function replyFor(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) {
    return "Say something and I'll work it. Silence isn't a threat I can score.";
  }
  return [
    "Deebo's on it — but this backend is still a scaffold, so here's the honest answer:",
    "",
    `I received ${trimmed.length} characters. The ELITE responder isn't wired into Convex yet,`,
    "so I can't score, analyse, or act on it from here. Nothing was sent anywhere, and nothing",
    "was checked against your mail.",
    "",
    "Confidence Level: High — that this is a placeholder reply.",
  ].join("\n");
}

/** Inserts one turn. Shared by the HTTP action and the future responder. */
export const appendMessage = internalMutation({
  args: {
    sessionId: v.string(),
    role: v.union(v.literal("user"), v.literal("assistant")),
    content: v.string(),
  },
  returns: v.id("messages"),
  handler: async (ctx, args) => {
    return await insertTurn(ctx, args.sessionId, args.role, args.content);
  },
});

/**
 * Records a whole exchange: the user's message, then Deebo's reply.
 * Returns the reply text so the HTTP action can hand it straight back.
 */
export const recordTurn = internalMutation({
  args: {
    sessionId: v.string(),
    content: v.string(),
  },
  returns: v.object({ sessionId: v.string(), reply: v.string() }),
  handler: async (ctx, args) => {
    const sessionId = args.sessionId.trim() || "anon";
    await insertTurn(ctx, sessionId, "user", args.content);
    const reply = replyFor(args.content);
    await insertTurn(ctx, sessionId, "assistant", reply);
    return { sessionId, reply };
  },
});

/** Reads one session's transcript, oldest first. */
export const transcript = internalQuery({
  args: {
    sessionId: v.string(),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("messages"),
      role: v.union(v.literal("user"), v.literal("assistant")),
      content: v.string(),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? 50, 1), MAX_TRANSCRIPT);
    const rows = await ctx.db
      .query("messages")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .order("asc")
      .take(limit);
    return rows.map((r) => ({
      _id: r._id,
      role: r.role,
      content: r.content,
      createdAt: r.createdAt,
    }));
  },
});

async function insertTurn(
  ctx: MutationCtx,
  sessionId: string,
  role: "user" | "assistant",
  content: string,
): Promise<Id<"messages">> {
  return await ctx.db.insert("messages", {
    sessionId: sessionId.trim() || "anon",
    role,
    content: content.slice(0, MAX_CONTENT),
    createdAt: Date.now(),
  });
}

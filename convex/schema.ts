/**
 * Robo Deebo — Convex schema (scaffold).
 *
 * Mirrors what the site actually persists today in SQLite
 * (`src/lib/sqlite.ts` → `data/deebo.db`): chat turns, email-watch scan
 * results, the per-user email connection, and the account model the chat is
 * scoped to. Nothing here is invented: every column below has a writer in this
 * directory or is a straight port of a column that already exists in SQLite.
 *
 * Deliberately NOT modelled yet (no writer, so no columns):
 *   - actions / audit log        (SQLite `actions`)   — port with the approval loop
 *   - per-email URL reputation   (SQLite `email_links`) — port with src/lib/urlcheck.ts
 *   - invites                    (SQLite `invites`)   — stays in the site until accounts move
 */
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  /** Mirror of the account model so a chat session can be scoped to a person.
   *  Same fields as `AccountRow` minus the password material: Convex does not
   *  hold credentials — `src/lib/auth.ts` (scrypt + HMAC cookie) stays the
   *  source of truth until the account move is planned. */
  users: defineTable({
    handle: v.string(),
    name: v.string(),
    role: v.union(v.literal("owner"), v.literal("member")),
    createdAt: v.number(),
  }).index("by_handle", ["handle"]),

  /** Chat transcript. One row per turn, ordered by createdAt within a session. */
  messages: defineTable({
    sessionId: v.string(),
    role: v.union(v.literal("user"), v.literal("assistant")),
    content: v.string(),
    createdAt: v.number(),
  }).index("by_session", ["sessionId", "createdAt"]),

  /** One row per scanned email (port of SQLite `emails`). `verdict: "unscored"`
   *  means the row records that a pass happened but nothing was actually
   *  fetched or scored — that is what the placeholder watcher writes today. */
  scans: defineTable({
    messageId: v.string(), // RFC822 Message-ID; "" when no message was involved
    from: v.string(),
    subject: v.string(),
    verdict: v.union(
      v.literal("safe"),
      v.literal("suspect"),
      v.literal("phish"),
      v.literal("unscored"),
    ),
    score: v.number(), // 0..100 composite from src/lib/phishing.ts
    reasons: v.array(v.string()),
    links: v.array(v.string()),
    createdAt: v.number(),
  })
    .index("by_message_id", ["messageId"])
    .index("by_created", ["createdAt"]),

  /** Per-user email connection (port of SQLite `user_settings` + the account
   *  scope). The app password is sealed with AES-GCM before it ever reaches
   *  this table — see convex/lib/secrets.ts. There is no plaintext column. */
  watches: defineTable({
    userId: v.id("users"),
    provider: v.union(v.literal("gmail"), v.literal("outlook"), v.literal("other")),
    email: v.string(),
    secretCiphertext: v.string(), // base64, AES-GCM
    secretIv: v.string(), // base64, 12 bytes
    enabled: v.boolean(),
    lastRunAt: v.optional(v.number()),
    lastRunOk: v.optional(v.boolean()),
    lastError: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_enabled", ["enabled"]),
});

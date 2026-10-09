/**
 * ROBO DEEBO — local email-watch database (bun:sqlite).
 *
 * Server-only. The free-beta decision is "no external DB": scanned messages,
 * sync health, and the action audit log live in a sqlite file at an ABSOLUTE
 * pinned path — /home/team/shared/site/data/deebo.db — so dev and the
 * production build resolve to the SAME database (the slice-2 bug was
 * import.meta.dir drifting between src/lib and dist/server, producing two
 * divergent databases). Every function degrades gracefully and never throws
 * outward — the server fns layer honest "storage broken" states instead of
 * crashing.
 *
 * Imported by src/lib/server.ts; used only inside createServerFn handlers and
 * the IMAP sync routine. Never import this from a client component directly.
 */
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * The one database file, dev or prod. Absolute on purpose — do NOT resolve
 * against import.meta.dir (dev builds and prod builds put that in different
 * trees). $DEEBO_DB_PATH exists only for tests/sandboxes; the default is the
 * pinned shared-tree path.
 */
const DB_PATH = process.env.DEEBO_DB_PATH || "/home/team/shared/site/data/deebo.db";

export function dbFilePath(): string {
  return DB_PATH;
}

let _db: Database | null = null;

/** Lazily open (and initialize/migrate) the sqlite database. Throws on real IO failure. */
function open(): Database {
  if (_db) return _db;
  mkdirSync(dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS emails (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id TEXT NOT NULL UNIQUE,
      imap_uid INTEGER,
      subject TEXT NOT NULL DEFAULT '',
      sender TEXT NOT NULL DEFAULT '',
      date TEXT NOT NULL DEFAULT '',
      body_snippet TEXT NOT NULL DEFAULT '',
      flags TEXT NOT NULL DEFAULT '[]',
      score INTEGER NOT NULL DEFAULT 0,
      band TEXT NOT NULL DEFAULT 'Low',
      verdict TEXT NOT NULL DEFAULT 'safe',
      elite TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      scanned_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_emails_recent ON emails (scanned_at DESC, id DESC);
    CREATE TABLE IF NOT EXISTS sync_meta (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      last_sync_at TEXT,
      last_sync_ok INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      message_count INTEGER NOT NULL DEFAULT 0
    );
    INSERT OR IGNORE INTO sync_meta (id, last_sync_ok, message_count) VALUES (1, 0, 0);
    -- Audit log: every acted-upon or attempted action lands here.
    CREATE TABLE IF NOT EXISTS actions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email_id INTEGER NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      executed_at TEXT NOT NULL DEFAULT (datetime('now')),
      result TEXT NOT NULL DEFAULT '',
      error TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_actions_email ON actions (email_id, id DESC);
    CREATE INDEX IF NOT EXISTS idx_actions_recent ON actions (id DESC);
    -- Slice 5: per-email URL reputation.
    CREATE TABLE IF NOT EXISTS email_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email_id INTEGER NOT NULL,
      url TEXT NOT NULL,
      final_url TEXT NOT NULL DEFAULT '',
      host TEXT NOT NULL DEFAULT '',
      shortener INTEGER NOT NULL DEFAULT 0,
      shortener_hops INTEGER NOT NULL DEFAULT 0,
      heuristic_verdict TEXT NOT NULL DEFAULT 'safe',
      heuristic_reason TEXT NOT NULL DEFAULT '',
      gsb_verdict TEXT NOT NULL DEFAULT 'unavailable',
      gsb_threats TEXT NOT NULL DEFAULT '',
      gsb_source TEXT NOT NULL DEFAULT '',
      combined TEXT NOT NULL DEFAULT 'safe',
      combined_reason TEXT NOT NULL DEFAULT '',
      checked_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_email_links_email ON email_links (email_id, id);
    -- Slice 4: real accounts + sessions + invites (password auth).
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      handle TEXT NOT NULL UNIQUE COLLATE NOCASE,
      name TEXT NOT NULL DEFAULT '',
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      account_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_account ON sessions (account_id, id);
    CREATE TABLE IF NOT EXISTS invites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      created_by INTEGER,
      uses_total INTEGER NOT NULL DEFAULT 1,
      uses_used INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  // Safe migrations for DBs created before these columns/tables existed.
  const cols = db.query("PRAGMA table_info(emails)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "explanation")) {
    db.exec("ALTER TABLE emails ADD COLUMN explanation TEXT NOT NULL DEFAULT ''");
  }
  if (!cols.some((c) => c.name === "imap_uid")) {
    db.exec("ALTER TABLE emails ADD COLUMN imap_uid INTEGER");
  }
  _db = db;
  return db;
}

/* ------------------------------------------------------------------ */
/* Typed rows                                                          */
/* ------------------------------------------------------------------ */

export interface EmailRow {
  id: number;
  message_id: string;
  imap_uid: number | null;
  subject: string;
  sender: string;
  date: string;
  body_snippet: string;
  flags: string; // JSON array string, as stored
  score: number;
  band: string; // Low | Medium | High | Critical (engine band)
  verdict: string; // safe | suspect | phish
  elite: string;
  explanation: string;
  status: string; // pending | acted | dismissed | failed (per-message life state)
  scanned_at: string;
}

export interface SyncMetaRow {
  last_sync_at: string | null;
  last_sync_ok: number;
  last_error: string | null;
  message_count: number;
}

export interface ActionRow {
  id: number;
  email_id: number;
  kind: string; // move-to-spam | dismiss
  status: string; // executed | failed
  executed_at: string;
  result: string;
  error: string;
  created_at: string;
}

export interface ActionWithSubject extends ActionRow {
  subject: string;
}

export interface LinkRow {
  id: number;
  email_id: number;
  url: string;
  final_url: string;
  host: string;
  shortener: number;
  shortener_hops: number;
  heuristic_verdict: string; // safe | suspicious | dangerous
  heuristic_reason: string;
  gsb_verdict: string; // safe | dangerous | unavailable
  gsb_threats: string; // JSON array string, as stored
  gsb_source: string;
  combined: string; // safe | suspicious | dangerous
  combined_reason: string;
  checked_at: string;
}

export interface LinkInput {
  url: string;
  final_url: string;
  host: string;
  shortener: boolean;
  shortener_hops: number;
  heuristic_verdict: string;
  heuristic_reason: string;
  gsb_verdict: string;
  gsb_threats: string[];
  gsb_source: string;
  combined: string;
  combined_reason: string;
}

/** Inserts or refreshes a scanned email; keeps the patrol status on re-scan. */
export function upsertEmail(e: {
  message_id: string;
  imap_uid: number | null;
  subject: string;
  sender: string;
  date: string;
  body_snippet: string;
  flags: string[];
  score: number;
  band: string;
  verdict: string;
  elite: string;
  explanation: string;
}): number {
  const db = open();
  db.query(
    `INSERT INTO emails
       (message_id, imap_uid, subject, sender, date, body_snippet, flags, score, band, verdict, elite, explanation)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(message_id) DO UPDATE SET
       imap_uid=excluded.imap_uid, subject=excluded.subject, sender=excluded.sender,
       date=excluded.date, body_snippet=excluded.body_snippet, flags=excluded.flags,
       score=excluded.score, band=excluded.band, verdict=excluded.verdict,
       elite=excluded.elite, explanation=excluded.explanation,
       scanned_at=excluded.scanned_at,
       status=emails.status`
  ).run(
    e.message_id,
    e.imap_uid,
    e.subject,
    e.sender,
    e.date,
    e.body_snippet,
    JSON.stringify(e.flags),
    e.score,
    e.band,
    e.verdict,
    e.elite,
    e.explanation
  );
  const r = db.query("SELECT id FROM emails WHERE message_id = ?").get(e.message_id) as { id: number } | null;
  return r?.id ?? 0;
}

/* ------------------------------------------------------------------ */
/* URL reputation (slice 5)                                            */
/* ------------------------------------------------------------------ */

/** Replace an email's link assessments (re-scan refreshes the whole set). */
export function replaceEmailLinks(emailId: number, links: LinkInput[]): void {
  const db = open();
  db.query("DELETE FROM email_links WHERE email_id = ?").run(emailId);
  for (const l of links) {
    db.query(
      `INSERT INTO email_links
         (email_id, url, final_url, host, shortener, shortener_hops,
          heuristic_verdict, heuristic_reason, gsb_verdict, gsb_threats, gsb_source,
          combined, combined_reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      emailId,
      l.url,
      l.final_url,
      l.host,
      l.shortener ? 1 : 0,
      l.shortener_hops,
      l.heuristic_verdict,
      l.heuristic_reason,
      l.gsb_verdict,
      JSON.stringify(l.gsb_threats),
      l.gsb_source,
      l.combined,
      l.combined_reason
    );
  }
}

/** Link assessments for one email, newest first. */
export function listEmailLinks(emailId: number): LinkRow[] {
  const db = open();
  const rows = db
    .query("SELECT * FROM email_links WHERE email_id = ? ORDER BY id ASC")
    .all(emailId) as unknown as LinkRow[];
  return rows;
}

/** Total executed actions in the audit log (all history, not just the bench). */
export function countExecutedActions(): number {
  const db = open();
  const r = db.query("SELECT COUNT(*) AS n FROM actions WHERE status = 'executed'").get() as { n: number };
  return r.n;
}

/** Most recent scanned emails first. */
export function listEmails(limit = 50): EmailRow[] {
  const db = open();
  const rows = db
    .query("SELECT * FROM emails ORDER BY scanned_at DESC, id DESC LIMIT ?")
    .all(limit) as unknown as EmailRow[];
  return rows;
}

export function countEmails(): number {
  const db = open();
  const r = db.query("SELECT COUNT(*) AS n FROM emails").get() as { n: number };
  return r.n;
}

export function getEmail(id: number): EmailRow | null {
  const db = open();
  const r = db.query("SELECT * FROM emails WHERE id = ?").get(id) as unknown as EmailRow | null;
  return r ?? null;
}

export function setEmailStatus(id: number, status: string): void {
  const db = open();
  db.query("UPDATE emails SET status = ? WHERE id = ?").run(status, id);
}

export function getSyncMeta(): SyncMetaRow {
  const db = open();
  const r = db.query("SELECT * FROM sync_meta WHERE id = 1").get() as unknown as SyncMetaRow;
  return r;
}

export function setSyncOk(at: string, count: number): void {
  const db = open();
  db.query(
    "UPDATE sync_meta SET last_sync_at=?, last_sync_ok=1, last_error=NULL, message_count=? WHERE id=1"
  ).run(at, count);
}

export function setSyncError(at: string, error: string): void {
  const db = open();
  db.query(
    "UPDATE sync_meta SET last_sync_at=?, last_sync_ok=0, last_error=? WHERE id=1"
  ).run(at, error);
}

/* ------------------------------------------------------------------ */
/* Action audit log                                                    */
/* ------------------------------------------------------------------ */

/** Append an audit row. executed_at defaults to sqlite now(); pass ISO for consistency. */
export function addAction(a: {
  email_id: number;
  kind: string;
  status: string;
  result?: string;
  error?: string;
  executed_at?: string;
}): number {
  const db = open();
  const r = db
    .query(
      `INSERT INTO actions (email_id, kind, status, executed_at, result, error)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(a.email_id, a.kind, a.status, a.executed_at ?? new Date().toISOString(), a.result ?? "", a.error ?? "");
  return Number(r.lastInsertRowid);
}

/** Latest action row for one email, or null. */
export function latestActionForEmail(emailId: number): ActionRow | null {
  const db = open();
  const r = db
    .query("SELECT * FROM actions WHERE email_id = ? ORDER BY id DESC LIMIT 1")
    .get(emailId) as unknown as ActionRow | null;
  return r ?? null;
}

/** Latest action per email for a batch of ids (Map keyed by email id). */
export function latestActionsByEmail(ids: number[]): Map<number, ActionRow> {
  const map = new Map<number, ActionRow>();
  if (!ids.length) return map;
  const db = open();
  const rows = db
    .query(`SELECT * FROM actions WHERE email_id IN (${ids.map(() => "?").join(",")}) ORDER BY id DESC`)
    .all(...ids) as unknown as ActionRow[];
  for (const r of rows) {
    if (!map.has(r.email_id)) map.set(r.email_id, r);
  }
  return map;
}

/** Most recent actions overall, joined with the email subject (for the ACTION LOG). */
export function listActions(limit = 10): ActionWithSubject[] {
  const db = open();
  const rows = db
    .query(
      `SELECT a.id, a.email_id, a.kind, a.status, a.executed_at, a.result, a.error, a.created_at,
              COALESCE(e.subject, '(message no longer on bench)') AS subject
       FROM actions a LEFT JOIN emails e ON e.id = a.email_id
       ORDER BY a.id DESC LIMIT ?`
    )
    .all(limit) as unknown as ActionWithSubject[];
  return rows;
}

/** Storage health probe: returns the db path and how many tables exist. */
export function storageHealth(): { ok: boolean; path: string; tables: number; error?: string } {
  try {
    const db = open();
    const r = db.query("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'").get() as { n: number };
    return { ok: true, path: dbFilePath(), tables: r.n };
  } catch (e) {
    return { ok: false, path: dbFilePath(), tables: 0, error: String((e as Error)?.message ?? e) };
  }
}

/* ------------------------------------------------------------------ */
/* Slice 4 — accounts, sessions, invites (password auth)               */
/* ------------------------------------------------------------------ */

export interface AccountRow {
  id: number;
  handle: string;
  name: string;
  password_hash: string;
  password_salt: string;
  role: "owner" | "member";
  created_at: string;
}

export interface InviteRow {
  id: number;
  code: string;
  created_by: number | null;
  uses_total: number;
  uses_used: number;
  expires_at: string | null;
  created_at: string;
}

export function countAccounts(): number {
  const db = open();
  const r = db.query("SELECT COUNT(*) AS n FROM accounts").get() as { n: number };
  return r.n;
}

export function ownerCount(): number {
  const db = open();
  const r = db.query("SELECT COUNT(*) AS n FROM accounts WHERE role = 'owner'").get() as { n: number };
  return r.n;
}

/** Case-insensitive handle lookup. */
export function getAccountByHandle(handle: string): AccountRow | null {
  const db = open();
  const r = db.query("SELECT * FROM accounts WHERE handle = ? COLLATE NOCASE").get(handle.trim()) as
    | AccountRow
    | null;
  return r ?? null;
}

export function getAccountById(id: number): AccountRow | null {
  const db = open();
  const r = db.query("SELECT * FROM accounts WHERE id = ?").get(id) as AccountRow | null;
  return r ?? null;
}

/** First account in this beta bootstraps as owner via the built-in code. */
export function createAccount(a: {
  handle: string;
  name: string;
  passwordHash: string;
  passwordSalt: string;
  role: "owner" | "member";
}): number {
  const db = open();
  const r = db
    .query("INSERT INTO accounts (handle, name, password_hash, password_salt, role) VALUES (?, ?, ?, ?, ?)")
    .run(a.handle.trim(), a.name.trim(), a.passwordHash, a.passwordSalt, a.role);
  return Number(r.lastInsertRowid);
}

export function updateAccountPassword(id: number, hash: string, salt: string): void {
  const db = open();
  db.query("UPDATE accounts SET password_hash = ?, password_salt = ? WHERE id = ?").run(hash, salt, id);
}

export function setAccountName(id: number, name: string): void {
  const db = open();
  db.query("UPDATE accounts SET name = ? WHERE id = ?").run(name.trim(), id);
}

export function createSession(id: string, accountId: number, expiresAt: string): void {
  const db = open();
  db.query("INSERT OR REPLACE INTO sessions (id, account_id, expires_at) VALUES (?, ?, ?)").run(
    id,
    accountId,
    expiresAt
  );
}

export function getSession(id: string): { id: string; account_id: number; expires_at: string } | null {
  const db = open();
  const r = db.query("SELECT * FROM sessions WHERE id = ?").get(id) as
    | { id: string; account_id: number; expires_at: string }
    | null;
  return r ?? null;
}

export function deleteSession(id: string): void {
  const db = open();
  db.query("DELETE FROM sessions WHERE id = ?").run(id);
}

/** Drop expired sessions (called at session creation; harmless sweep). */
export function sweepExpiredSessions(): void {
  const db = open();
  db.query("DELETE FROM sessions WHERE expires_at < ?").run(new Date().toISOString());
}

export function mintInvite(a: { code: string; createdBy: number; usesTotal: number; expiresAt: string | null }): void {
  const db = open();
  db.query("INSERT INTO invites (code, created_by, uses_total, expires_at) VALUES (?, ?, ?, ?)").run(
    a.code,
    a.createdBy,
    a.usesTotal,
    a.expiresAt
  );
}

export function getInviteByCode(code: string): InviteRow | null {
  const db = open();
  const r = db.query("SELECT * FROM invites WHERE code = ? COLLATE NOCASE").get(code.trim()) as InviteRow | null;
  return r ?? null;
}

export function consumeInvite(id: number): void {
  const db = open();
  db.query("UPDATE invites SET uses_used = uses_used + 1 WHERE id = ?").run(id);
}

/** Unused, unexpired invites, newest first (owner's sharing list). */
export function listInvites(): InviteRow[] {
  const db = open();
  const now = new Date().toISOString();
  const rows = db
    .query(
      "SELECT * FROM invites WHERE uses_used < uses_total AND (expires_at IS NULL OR expires_at > ?) ORDER BY id DESC"
    )
    .all(now) as unknown as InviteRow[];
  return rows;
}

/** True if an invite is still redeemable (unused + not expired). */
export function inviteRedeemable(code: string): boolean {
  const r = getInviteByCode(code);
  if (!r) return false;
  if (r.uses_used >= r.uses_total) return false;
  if (r.expires_at && r.expires_at < new Date().toISOString()) return false;
  return true;
}
/**
 * ROBO DEEBO — local email-watch database (bun:sqlite).
 *
 * Server-only. The free-beta decision is "no external DB": scanned messages and
 * sync health live in a sqlite file under /home/team/shared/site/data/deebo.db
 * (the shared tree survives machine swaps; the file is git-ignored). Every
 * function degrades gracefully and never throws outward — the server fns layer
 * honest "storage broken" states instead of crashing.
 *
 * Imported by src/lib/server.ts; used only inside createServerFn handlers and
 * the IMAP sync routine. Never import this from a client component directly.
 */
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

/** site/data/deebo.db — import.meta.dir is src/lib (dev) or dist/server (prod build). */
export function dbFilePath(): string {
  return resolve(import.meta.dir, "../../data/deebo.db");
}

let _db: Database | null = null;

/** Lazily open (and initialize) the sqlite database. Throws on real IO failure. */
function open(): Database {
  if (_db) return _db;
  mkdirSync(resolve(import.meta.dir, "../../data"), { recursive: true });
  const db = new Database(dbFilePath());
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS emails (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id TEXT NOT NULL UNIQUE,
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
  `);
  // Safe migration for DBs created before the explanation column existed.
  const cols = db.query("PRAGMA table_info(emails)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "explanation")) {
    db.exec("ALTER TABLE emails ADD COLUMN explanation TEXT NOT NULL DEFAULT ''");
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
  status: string; // pending | approved | dismissed
  scanned_at: string;
}

export interface SyncMetaRow {
  last_sync_at: string | null;
  last_sync_ok: number;
  last_error: string | null;
  message_count: number;
}

/** Inserts or refreshes a scanned email; keeps the patrol status on re-scan. */
export function upsertEmail(e: {
  message_id: string;
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
}): void {
  const db = open();
  db.query(
    `INSERT INTO emails
       (message_id, subject, sender, date, body_snippet, flags, score, band, verdict, elite, explanation)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(message_id) DO UPDATE SET
       subject=excluded.subject, sender=excluded.sender, date=excluded.date,
       body_snippet=excluded.body_snippet, flags=excluded.flags, score=excluded.score,
       band=excluded.band, verdict=excluded.verdict, elite=excluded.elite,
       explanation=excluded.explanation,
       scanned_at=excluded.scanned_at,
       status=emails.status`
  ).run(
    e.message_id,
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
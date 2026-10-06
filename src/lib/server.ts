/**
 * Robo Deebo copilot — server-side helpers (env status, settings persistence,
 * live email watch).
 * All client-safe: called through createServerFn so process.env stays server-only.
 * Every function degrades gracefully when creds / storage are missing — the UI
 * renders honest "waiting for setup" / exact-failure states instead of crashing.
 */
import { createServerFn } from "@tanstack/react-start";
import { sql } from "~/db";
import { storageHealth, listEmails, countEmails, getSyncMeta, type EmailRow, type SyncMetaRow } from "./sqlite";
import { runEmailSync, emailConfigured, type SyncResult } from "./imap";

export interface SystemStatus {
  dbConfigured: boolean;
  tigerConfigured: boolean;
  emailConfigured: boolean;
  betaCode: string;
  /** Server-side Gmail seam: GMAIL_USER drives the IMAP watcher. */
  gmailUser: string;
  /** Local sqlite storage health (free-beta storage decision: no cloud DB). */
  storage: { ok: boolean; path: string; tables: number };
  /** Live email-watch state from sync_meta. */
  emailWatch: {
    connected: boolean;
    lastSyncAt: string | null;
    lastSyncOk: boolean | null; // null = never ran
    lastError: string | null;
    scannedCount: number;
  };
}

/** DATABASE_URL here is a 26-char Tiger code, not a usable postgres:// URL —
 *  treat it as unconfigured until the owner lands a real database. */
function realDbAvailable(): boolean {
  const url = process.env.DATABASE_URL || "";
  return /^postgres(ql)?:\/\//.test(url);
}

export const getSystemStatus = createServerFn().handler(async (): Promise<SystemStatus> => {
  const storage = storageHealth();
  const meta = storage.ok ? getSyncMeta() : null;
  const connected = emailConfigured();
  return {
    dbConfigured: realDbAvailable(),
    tigerConfigured: !!(
      process.env.TIGER_PUBLIC_KEY && process.env.TIGER_SECRET_KEY && process.env.TIGER_PROJECT_ID
    ),
    emailConfigured: connected,
    // Beta gate: $BETA_INVITE_CODE if set, else the v0 hardcoded code.
    betaCode: process.env.BETA_INVITE_CODE || "DEEBO-BETA-2026",
    gmailUser: process.env.GMAIL_USER || "",
    storage,
    emailWatch: {
      connected,
      lastSyncAt: meta?.last_sync_at ?? null,
      lastSyncOk: meta ? meta.last_sync_ok === 1 : null,
      lastError: meta?.last_error ?? null,
      scannedCount: storage.ok ? countEmails() : 0,
    },
  };
});

export interface ConnectionInput {
  provider: "gmail" | "outlook" | "other";
  email: string;
  appPassword: string;
}

export interface ConnectionSaveResult {
  mode: "db" | "local";
  savedEmail: string;
  note: string;
}

/** Persist the email connection. DB if a real DATABASE_URL exists; otherwise the
 *  client falls back to localStorage and we say so honestly. */
export const saveConnection = createServerFn({ method: "POST" }).handler(
  async ({ data }): Promise<ConnectionSaveResult> => {
    const d = (data ?? {}) as Partial<ConnectionInput>;
    const provider = d.provider || "other";
    const email = (d.email || "").trim();
    const appPassword = d.appPassword || "";
    if (!realDbAvailable()) {
      return {
        mode: "local",
        savedEmail: email,
        note: "No cloud database yet — this connection is saved locally in this browser. Deebo's email watch itself runs server-side with the owner's configured account.",
      };
    }
    // NOTE: storing the app password in plaintext in our own DB is a deliberate,
    // temporary hack — the secrets vault / real auth is a later build.
    const db = sql();
    await db`CREATE TABLE IF NOT EXISTS user_settings (
      id integer PRIMARY KEY,
      provider text NOT NULL DEFAULT 'other',
      email text NOT NULL DEFAULT '',
      app_password text NOT NULL DEFAULT '',
      updated_at timestamptz NOT NULL DEFAULT now()
    )`;
    await db`INSERT INTO user_settings (id, provider, email, app_password)
             VALUES (1, ${provider}, ${email}, ${appPassword})
             ON CONFLICT (id) DO UPDATE
               SET provider = EXCLUDED.provider, email = EXCLUDED.email,
                   app_password = EXCLUDED.app_password, updated_at = now()`;
    return {
      mode: "db",
      savedEmail: email,
      note: "Saved to the Robo Deebo database. The IMAP watcher picks this up on the next sync.",
    };
  }
);

export interface ConnectionLoaded {
  provider: string;
  email: string;
  hasPassword: boolean;
  inDb: boolean;
}

/** Load the stored connection (DB first; the client layers localStorage on top). */
export const loadConnection = createServerFn().handler(async (): Promise<ConnectionLoaded | null> => {
  if (!realDbAvailable()) return null;
  try {
    const db = sql();
    const rows = await db`SELECT provider, email, app_password FROM user_settings WHERE id = 1`;
    if (!rows?.length) return null;
    const r = rows[0] as { provider: string; email: string; app_password: string };
    return { provider: r.provider, email: r.email, hasPassword: !!r.app_password, inDb: true };
  } catch {
    return null; // table missing or db unreachable → honest local fallback
  }
});

/* ------------------------------------------------------------------ */
/* Live email watch                                                    */
/* ------------------------------------------------------------------ */

/** On-demand IMAP refresh. Bound to ~22s; failures are recorded, never thrown. */
export const triggerSync = createServerFn({ method: "POST" }).handler(
  async (): Promise<SyncResult> => runEmailSync()
);

export interface ScannedInbox {
  emails: EmailRow[];
  sync: SyncMetaRow | null;
}

/** Most recent scanned emails (real messages from the mailbox scan). */
export const listScannedEmails = createServerFn().handler(async (): Promise<ScannedInbox> => {
  const emails = listEmails(50);
  let sync: SyncMetaRow | null = null;
  try {
    sync = getSyncMeta();
  } catch {
    sync = null;
  }
  return { emails, sync };
});
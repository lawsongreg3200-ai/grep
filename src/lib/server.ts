/**
 * Robo Deebo copilot — server-side helpers (env status, settings persistence).
 * All client-safe: called through createServerFn so process.env stays server-only.
 * Every function degrades gracefully when DATABASE_URL / GMAIL_* are absent —
 * the UI renders honest "waiting for setup" states instead of crashing.
 */
import { createServerFn } from "@tanstack/react-start";
import { sql } from "~/db";

export interface SystemStatus {
  dbConfigured: boolean;
  tigerConfigured: boolean;
  emailConfigured: boolean;
  betaCode: string;
  /** Server-side Gmail seam: GMAIL_USER + GMAIL_APP_PASSWORD drive the IMAP watcher later. */
  gmailUser: string;
}

export const getSystemStatus = createServerFn().handler(async (): Promise<SystemStatus> => {
  const dbConfigured = !!process.env.DATABASE_URL;
  return {
    dbConfigured,
    tigerConfigured: !!(
      process.env.TIGER_PUBLIC_KEY && process.env.TIGER_SECRET_KEY && process.env.TIGER_PROJECT_ID
    ),
    emailConfigured: !!(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD),
    // Beta gate: $BETA_INVITE_CODE if set, else the v0 hardcoded code.
    betaCode: process.env.BETA_INVITE_CODE || "DEEBO-BETA-2026",
    gmailUser: process.env.GMAIL_USER || "",
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

/** Persist the email connection. DB if DATABASE_URL exists; otherwise the client
 *  falls back to localStorage and we say so honestly. */
export const saveConnection = createServerFn({ method: "POST" }).handler(
  async ({ data }): Promise<ConnectionSaveResult> => {
    const d = (data ?? {}) as Partial<ConnectionInput>;
    const provider = d.provider || "other";
    const email = (d.email || "").trim();
    const appPassword = d.appPassword || "";
    if (!process.env.DATABASE_URL) {
      return {
        mode: "local",
        savedEmail: email,
        note: "Database not connected — saved locally in this browser for now. It syncs to real storage the moment DATABASE_URL is live.",
      };
    }
    // NOTE (v0): storing the app password in plaintext in our own DB is a
    // deliberate, temporary hack — slice 2 (real auth + secrets vault) replaces it.
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
      note: "Saved to the Robo Deebo database. The IMAP watcher picks this up once sync is wired (slice 2).",
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
  if (!process.env.DATABASE_URL) return null;
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
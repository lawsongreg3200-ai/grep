/**
 * Robo Deebo copilot — server-side helpers (env status, settings persistence,
 * live email watch).
 * All client-safe: called through createServerFn so process.env stays server-only.
 * Every function degrades gracefully when creds / storage are missing — the UI
 * renders honest "waiting for setup" / exact-failure states instead of crashing.
 */
import { createServerFn } from "@tanstack/react-start";
import { sql } from "~/db";
import {
  storageHealth,
  listEmails,
  countEmails,
  getSyncMeta,
  getEmail,
  setEmailStatus,
  addAction,
  latestActionsByEmail,
  listActions,
  listEmailLinks,
  countExecutedActions,
  type EmailRow,
  type SyncMetaRow,
  type ActionRow,
  type ActionWithSubject,
  type LinkRow,
} from "./sqlite";
import { runEmailSync, emailConfigured, moveMessageToSpam, type SyncResult } from "./imap";
import { gsbConfigured } from "./urlcheck";
import {
  countAccounts,
  ownerCount,
  createAccount,
  getAccountByHandle,
  updateAccountPassword,
  mintInvite,
  listInvites as listInvitesRows,
  inviteRedeemable,
  consumeInvite,
  getInviteByCode,
  type InviteRow,
} from "./sqlite";
import {
  hashPassword,
  newSalt,
  verifyPassword,
  passwordPolicyError,
  validateHandle,
  startSession,
  endSession,
  sessionUser,
  type SessionUser,
} from "./auth";
import { randomBytes } from "node:crypto";

/** The built-in bootstrap code doubles as the first account's invite when the
 *  beta has no owner yet. After that, only owner-minted invites work. */
function effectiveBetaCode(): string {
  return process.env.BETA_INVITE_CODE || "DEEBO-BETA-2026";
}

function newInviteCode(): string {
  return "RD-" + randomBytes(5).toString("hex").toUpperCase();
}

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
  /** Google Safe Browsing key present in env (server-only; just a boolean). */
  gsbConfigured: boolean;
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
    gsbConfigured: gsbConfigured(),
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
/* Slice 4 — real accounts + sessions (replaces the localStorage gate) */
/* ------------------------------------------------------------------ */

export interface AccountView {
  id: number;
  handle: string;
  name: string;
  role: "owner" | "member";
}

export interface AuthResult {
  ok: boolean;
  error?: string;
  account?: AccountView;
  /** True when the caller is already the signed-in user (idempotent submit). */
  already?: boolean;
}

function toView(u: SessionUser): AccountView {
  return u.account;
}

function currentUser(): SessionUser | null {
  return sessionUser();
}

/** Register: needs a redeemable invite; first account = owner (bootstrap code). */
export const register = createServerFn({ method: "POST" }).handler(async ({ data }): Promise<AuthResult> => {
  const d = (data ?? {}) as Partial<{ handle: string; name: string; password: string; inviteCode: string }>;
  const handle = (d.handle || "").trim();
  const name = (d.name || "").trim();
  const password = d.password || "";
  const inviteCode = (d.inviteCode || "").trim();
  const handleErr = validateHandle(handle);
  if (handleErr) return { ok: false, error: handleErr };
  const pwErr = passwordPolicyError(password);
  if (pwErr) return { ok: false, error: pwErr };
  if (!name) return { ok: false, error: "Tell Deebo your name so the squad knows who's who." };
  if (getAccountByHandle(handle)) return { ok: false, error: "That handle's taken. Pick another yearbook name." };

  const isFirstAccount = countAccounts() === 0;
  const isOwnerInvite = isFirstAccount
    ? inviteCode.toUpperCase() === effectiveBetaCode().toUpperCase() && ownerCount() === 0
    : false;
  const hasMintedInvite = inviteRedeemable(inviteCode);
  if (!isOwnerInvite && !hasMintedInvite) {
    return { ok: false, error: "That invite code isn't on the list — check it and try again." };
  }
  if (isOwnerInvite && !isFirstAccount) {
    return { ok: false, error: "That invite's spent. The owner mints fresh ones now." };
  }
  const salt = newSalt();
  const id = createAccount({ handle, name, passwordHash: hashPassword(password, salt), passwordSalt: salt, role: isOwnerInvite ? "owner" : "member" });
  if (!isOwnerInvite) consumeInvite(getInviteByCode(inviteCode)?.id ?? 0);
  startSession(id);
  return { ok: true, account: { id, handle, name, role: isOwnerInvite ? "owner" : "member" } };
});

/** Login with handle + password. */
export const login = createServerFn({ method: "POST" }).handler(async ({ data }): Promise<AuthResult> => {
  const d = (data ?? {}) as Partial<{ handle: string; password: string }>;
  const handle = (d.handle || "").trim();
  const password = d.password || "";
  const acct = getAccountByHandle(handle);
  if (!acct || !verifyPassword(password, acct.password_salt, acct.password_hash)) {
    return { ok: false, error: "Handle or password didn't match. Deebo's got a great memory — try again." };
  }
  startSession(acct.id);
  return { ok: true, account: { id: acct.id, handle: acct.handle, name: acct.name, role: acct.role } };
});

/** Log out: revoke the session row and clear the cookie. */
export const logout = createServerFn({ method: "POST" }).handler(async (): Promise<{ ok: boolean }> => {
  try {
    endSession();
  } catch {
    /* already gone */
  }
  return { ok: true };
});

/** Who am I? Drives the gate on the client. */
export const whoami = createServerFn().handler(async (): Promise<AccountView | null> => {
  const u = currentUser();
  return u ? toView(u) : null;
});

/** Owner-only: mint an invite code to share. */
export const createInvite = createServerFn({ method: "POST" }).handler(async ({ data }): Promise<AuthResult & { invite?: string }> => {
  const u = currentUser();
  if (!u) return { ok: false, error: "You need to be logged in for that." };
  if (u.account.role !== "owner") return { ok: false, error: "Only the owner can hand out invite codes." };
  const d = (data ?? {}) as Partial<{ usesTotal: number; expiresInDays: number }>;
  const usesTotal = Math.min(Math.max(Number(d.usesTotal) || 1, 1), 25);
  const expDays = Number(d.expiresInDays) || 0;
  const expiresAt = expDays > 0 ? new Date(Date.now() + expDays * 86400000).toISOString() : null;
  const code = newInviteCode();
  mintInvite({ code, createdBy: u.account.id, usesTotal, expiresAt });
  return { ok: true, invite: code };
});

/** Owner-only: unused invite codes for sharing. */
export const listInvites = createServerFn().handler(async (): Promise<{ ok: boolean; invites: InviteRow[]; error?: string }> => {
  const u = currentUser();
  if (!u) return { ok: false, invites: [], error: "You need to be logged in for that." };
  if (u.account.role !== "owner") return { ok: false, invites: [], error: "Only the owner can see invites." };
  const invites = listInvitesRows().map((i) => ({ ...i }));
  return { ok: true, invites };
});

/** Owner-only: change password (verifies the current one first). */
export const changePassword = createServerFn({ method: "POST" }).handler(
  async ({ data }): Promise<{ ok: boolean; error?: string }> => {
    const u = currentUser();
    if (!u) return { ok: false, error: "Not logged in." };
    const d = (data ?? {}) as Partial<{ current: string; next: string }>;
    const acct = getAccountByHandle(u.account.handle);
    if (!acct || !verifyPassword(d.current || "", acct.password_salt, acct.password_hash)) {
      return { ok: false, error: "Current password didn't match." };
    }
    const pwErr = passwordPolicyError(d.next || "");
    if (pwErr) return { ok: false, error: pwErr };
    const salt = newSalt();
    updateAccountPassword(acct.id, hashPassword(d.next || "", salt), salt);
    return { ok: true };
  }
);

/* ------------------------------------------------------------------ */
/* Live email watch                                                    */
/* ------------------------------------------------------------------ */

/** On-demand IMAP refresh. Bound to ~22s; failures are recorded, never thrown.
 *  Owner-scoped: the watch runs against the owner's mailbox only. */
export const triggerSync = createServerFn({ method: "POST" }).handler(
  async (): Promise<SyncResult> => {
    const u = currentUser();
    if (!u) {
      return { ok: false, stored: 0, durationMs: 0, error: "You need to be logged in for that." };
    }
    if (u.account.role !== "owner") {
      return { ok: false, stored: 0, durationMs: 0, error: "The beta watch covers the owner's mailbox — your own connection comes later." };
    }
    return runEmailSync();
  }
);

export interface ScannedInbox {
  emails: (EmailRow & { action: ActionRow | null; links: LinkRow[] })[];
  sync: SyncMetaRow | null;
  /** Last ~10 audited actions for the ACTION LOG (newest first). */
  latestActions: ActionWithSubject[];
  /** Total executed actions across ALL history (bench summary counter). */
  executedTotal: number;
  /** Who is looking (owner sees data; members see the friendly beta state). */
  viewer: "owner" | "member" | "anon";
}

/** Most recent scanned emails (real messages from the mailbox scan).
 *  Owner-scoped: members/anon never see mailbox content — they get an empty
 *  bench plus the viewer role so the UI can explain the beta honestly. */
export const listScannedEmails = createServerFn().handler(async (): Promise<ScannedInbox> => {
  const u = currentUser();
  if (!u) return { emails: [], sync: null, latestActions: [], executedTotal: 0, viewer: "anon" };
  if (u.account.role !== "owner") {
    return { emails: [], sync: null, latestActions: [], executedTotal: 0, viewer: "member" };
  }
  const emails = listEmails(50);
  let sync: SyncMetaRow | null = null;
  try {
    sync = getSyncMeta();
  } catch {
    sync = null;
  }
  const byId = latestActionsByEmail(emails.map((e) => e.id));
  const withActions = emails.map((e) => ({ ...e, action: byId.get(e.id) ?? null, links: listEmailLinks(e.id) }));
  let latestActions: ActionWithSubject[] = [];
  try {
    latestActions = listActions(10);
  } catch {
    latestActions = [];
  }
  let executedTotal = 0;
  try {
    executedTotal = countExecutedActions();
  } catch {
    executedTotal = 0;
  }
  return { emails: withActions, sync, latestActions, executedTotal, viewer: "owner" };
});

/* ------------------------------------------------------------------ */
/* Slice 3 — the approval loop that ACTS (owner-ratified)              */
/* ------------------------------------------------------------------ */

export interface ActResult {
  ok: boolean;
  emailId: number;
  subject: string;
  /** Post-call per-message state: acted | dismissed | failed | (unchanged). */
  status: string;
  outcome?: "moved" | "already-gone";
  result?: string;
  error?: string;
  actionId?: number;
}

/**
 * Move one flagged message to Gmail's Spam — only ever reached through the
 * owner's explicit two-step confirmation in the dashboard. Guards: the row
 * must exist, be band High or Medium, be status 'pending', and carry an
 * imap_uid (synced rows only). Idempotent: an already-acted row returns its
 * current state without touching the mailbox. Every attempt is audit-logged;
 * on failure the message is left safe in place (never expunged, never deleted).
 */
export const approveAndAct = createServerFn({ method: "POST" }).handler(
  async ({ data }): Promise<ActResult> => {
    const u = currentUser();
    if (!u) return { ok: false, emailId: 0, subject: "", status: "failed", error: "You need to be logged in for that." };
    if (u.account.role !== "owner") {
      return { ok: false, emailId: 0, subject: "", status: "failed", error: "Only the owner approves actions in this beta." };
    }
    const emailId = Number((data as { emailId?: unknown } | null)?.emailId);
    if (!Number.isInteger(emailId) || emailId <= 0) {
      return { ok: false, emailId, subject: "", status: "failed", error: "Invalid email id." };
    }
    try {
      const row = getEmail(emailId);
      if (!row) {
        return { ok: false, emailId, subject: "", status: "failed", error: "Message not found on the patrol bench." };
      }
      if (row.status !== "pending") {
        return {
          ok: true,
          emailId,
          subject: row.subject,
          status: row.status,
          result: `Already ${row.status} — no action taken.`,
        };
      }
      if (row.band !== "High" && row.band !== "Medium") {
        return {
          ok: false,
          emailId,
          subject: row.subject,
          status: "failed",
          error: `Not a flagged message (band ${row.band}) — Deebo only acts on High/Medium flags.`,
        };
      }
      if (!row.imap_uid) {
        return {
          ok: false,
          emailId,
          subject: row.subject,
          status: "failed",
          error: "No IMAP UID recorded for this message yet — run SYNC NOW to refresh the bench, then try again.",
        };
      }
      const mv = await moveMessageToSpam(row.imap_uid);
      if (mv.ok) {
        setEmailStatus(emailId, "acted");
        const actionId = addAction({
          email_id: emailId,
          kind: "move-to-spam",
          status: "executed",
          result: `moved to spam — ${mv.outcome}`,
          error: "",
        });
        return {
          ok: true,
          emailId,
          subject: row.subject,
          status: "acted",
          outcome: mv.outcome,
          result:
            mv.outcome === "moved"
              ? "Moved to spam — message is now in Gmail's Spam folder."
              : "Message was already out of INBOX — marked complete.",
          actionId,
        };
      }
      // Failure: keep the message safe in place; record exactly why.
      setEmailStatus(emailId, "failed");
      const actionId = addAction({
        email_id: emailId,
        kind: "move-to-spam",
        status: "failed",
        result: "",
        error: mv.error || "unknown IMAP error",
      });
      return {
        ok: false,
        emailId,
        subject: row.subject,
        status: "failed",
        error: mv.error || "The move failed — see the action log. The message was left in place.",
        actionId,
      };
    } catch (e) {
      return {
        ok: false,
        emailId,
        subject: "",
        status: "failed",
        error: `Move could not be recorded: ${String((e as Error)?.message ?? e).slice(0, 240)}`,
      };
    }
  }
);

/** Owner says this one's fine — NO mailbox action, just audit-logged. */
export const dismissEmail = createServerFn({ method: "POST" }).handler(
  async ({ data }): Promise<ActResult> => {
    const u = currentUser();
    if (!u) return { ok: false, emailId: 0, subject: "", status: "failed", error: "You need to be logged in for that." };
    if (u.account.role !== "owner") {
      return { ok: false, emailId: 0, subject: "", status: "failed", error: "Only the owner dismisses messages in this beta." };
    }
    const emailId = Number((data as { emailId?: unknown } | null)?.emailId);
    if (!Number.isInteger(emailId) || emailId <= 0) {
      return { ok: false, emailId, subject: "", status: "failed", error: "Invalid email id." };
    }
    try {
      const row = getEmail(emailId);
      if (!row) {
        return { ok: false, emailId, subject: "", status: "failed", error: "Message not found on the patrol bench." };
      }
      if (row.status !== "pending") {
        return {
          ok: true,
          emailId,
          subject: row.subject,
          status: row.status,
          result: `Already ${row.status} — no action taken.`,
        };
      }
      setEmailStatus(emailId, "dismissed");
      const actionId = addAction({
        email_id: emailId,
        kind: "dismiss",
        status: "executed",
        result: "dismissed by owner — no action",
        error: "",
      });
      return {
        ok: true,
        emailId,
        subject: row.subject,
        status: "dismissed",
        result: "Dismissed — Deebo left it alone. Logged.",
        actionId,
      };
    } catch (e) {
      return {
        ok: false,
        emailId,
        subject: "",
        status: "failed",
        error: `Dismiss could not be recorded: ${String((e as Error)?.message ?? e).slice(0, 240)}`,
      };
    }
  }
);
/**
 * Robo Deebo — slice 4 auth (server-only).
 *
 * Password accounts with scrypt hashing (node:crypto, no new deps), HMAC-signed
 * session tokens delivered in an httpOnly cookie, and invite-gated registration.
 *
 * SECRET: an auth signing secret is generated once and persisted at
 * data/auth_secret (the /data dir is git-ignored — it is never committed and
 * never logged). Choice: file-backed in the site's local data dir because the
 * prod build and dev build share that pinned path, we have no secrets vault in
 * the beta, and it survives restarts. Anyone with filesystem access to the box
 * already owns the sqlite DB, so a second secret store buys nothing here.
 *
 * Imported by src/lib/server.ts only; never import from a client component.
 */
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { getCookie, setCookie, deleteCookie } from "@tanstack/react-start/server";
import {
  createSession,
  deleteSession,
  getAccountById,
  getSession,
  sweepExpiredSessions,
  type AccountRow,
} from "./sqlite";

const COOKIE_NAME = "deebo_session";
const SESSION_DAYS = 30;
const SECRET_PATH = "/home/team/shared/site/data/auth_secret";

/* ------------------------------------------------------------------ */
/* Signing secret (file-backed, git-ignored, never logged)             */
/* ------------------------------------------------------------------ */

let _secret: Buffer | null = null;
function secret(): Buffer {
  if (_secret) return _secret;
  try {
    if (existsSync(SECRET_PATH)) {
      _secret = Buffer.from(readFileSync(SECRET_PATH, "utf8").trim(), "hex");
    } else {
      _secret = randomBytes(32);
      mkdirSync(dirname(SECRET_PATH), { recursive: true });
      writeFileSync(SECRET_PATH, _secret.toString("hex"), { mode: 0o600 });
    }
  } catch {
    // Last resort: process-lifetime secret. Sessions won't survive a restart,
    // which is a visible logout — acceptable and never logged.
    _secret = randomBytes(32);
  }
  return _secret;
}

/* ------------------------------------------------------------------ */
/* Passwords — scrypt, per-user random salt (NIST-style guidance)      */
/* ------------------------------------------------------------------ */

export function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, 64).toString("hex");
}

export function newSalt(): string {
  return randomBytes(16).toString("hex");
}

export function verifyPassword(password: string, salt: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashPassword(password, salt), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Honest password policy: minimum length, no fabricated breach-list claims. */
export function passwordPolicyError(password: string): string | null {
  if (typeof password !== "string" || password.length < 8) {
    return "Password must be at least 8 characters. Longer is better — pick a passphrase, not a single dictionary word.";
  }
  return null;
}

export function validateHandle(handle: string): string | null {
  const h = handle.trim();
  if (!/^[a-zA-Z0-9_.-]{3,24}$/.test(h)) {
    return "Handle must be 3–24 characters: letters, numbers, dots, dashes, underscores.";
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Sessions — HMAC-signed token, httpOnly cookie, 30-day expiry        */
/* ------------------------------------------------------------------ */

export interface SessionUser {
  account: { id: number; handle: string; name: string; role: "owner" | "member" };
  sessionId: string;
}

function sign(sessionId: string, expiresEpochMs: number): string {
  const body = `${sessionId}.${expiresEpochMs}`;
  return `${body}.${createHmac("sha256", secret()).update(body).digest("hex")}`;
}

function setSessionCookie(token: string): void {
  setCookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

export function clearSessionCookie(): void {
  deleteCookie(COOKIE_NAME, { path: "/" });
}

/** Mint a session, persist it, and set the cookie. Returns the token. */
export function startSession(accountId: number): string {
  sweepExpiredSessions();
  const sessionId = randomBytes(24).toString("hex");
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  createSession(sessionId, accountId, expires.toISOString());
  const token = sign(sessionId, expires.getTime());
  setSessionCookie(token);
  return token;
}

export function endSession(): void {
  const user = sessionUser();
  if (user) deleteSession(user.sessionId);
  clearSessionCookie();
}

/** Verify the signed cookie and the live session row; sweep on error. */
export function sessionUser(): SessionUser | null {
  try {
    const raw = getCookie(COOKIE_NAME);
    if (!raw) return null;
    const parts = raw.split(".");
    if (parts.length !== 3) return null;
    const [sessionId, expStr, sig] = parts;
    const expires = Number(expStr);
    if (!Number.isFinite(expires) || expires < Date.now()) return null;
    const body = `${sessionId}.${expStr}`;
    const expect = createHmac("sha256", secret()).update(body).digest("hex");
    if (sig.length !== expect.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
    const row = getSession(sessionId);
    if (!row || new Date(row.expires_at).getTime() < Date.now()) return null;
    const acct = getAccountById(row.account_id);
    if (!acct) return null;
    return { account: { id: acct.id, handle: acct.handle, name: acct.name, role: acct.role }, sessionId };
  } catch {
    return null;
  }
}

export type { AccountRow };
/**
 * ROBO DEEBO — real IMAP sync for Inbox Patrol (server-only).
 *
 * Reads the owner's Gmail inbox over IMAPS (imap.gmail.com:993) using
 * imapflow, takes the most recent ~50 messages, parses headers + body,
 * runs the phishing heuristic (src/lib/phishing.ts), and persists rows to the
 * local sqlite store (src/lib/sqlite.ts).
 *
 * Honesty contract (owner-ratified): this WATCHES and SCORES only. It never
 * deletes, moves, sends, or marks anything on the mailbox. Every failure is
 * recorded in sync_meta and surfaced to the dashboard verbatim; the server
 * never crashes and a sync never runs longer than ~22s.
 *
 * Credentials: GMAIL_USER + (GENERATE_APP_PASSWORD ?? GMAIL_APP_PASSWORD) from
 * process.env. The app password may be saved space-separated ("abcd efgh ijkl
 * mnop") — spaces are stripped before authenticating. Values are read only,
 * never logged, never returned to the client.
 */
import { ImapFlow } from "imapflow";
import { scoreEmail, eliteAssessment, type ParsedEmail } from "./phishing";
import { upsertEmail, setSyncOk, setSyncError } from "./sqlite";

export interface SyncResult {
  ok: boolean;
  attempted: number; // messages fetched from the mailbox
  stored: number; // rows upserted into sqlite
  error?: string;
  durationMs: number;
  /** Machine-safe hint of the failure class ("auth" | "network" | "timeout" | "other"). */
  errorKind?: "auth" | "network" | "timeout" | "other";
}

const HOST = "imap.gmail.com";
const PORT = 993;
const MAX_FETCH = 50;
const SYNC_BUDGET_MS = 22_000;

export function emailCredentials(): { user: string; pass: string } {
  const user = process.env.GMAIL_USER || "";
  const pass = (process.env.GENERATE_APP_PASSWORD ?? process.env.GMAIL_APP_PASSWORD ?? "").replace(/\s+/g, "");
  return { user, pass };
}

/** True when process.env has a usable Gmail user + app password. */
export function emailConfigured(): boolean {
  const c = emailCredentials();
  return !!c.user && c.pass.length >= 8;
}

let inFlight: Promise<SyncResult> | null = null;

/** Run a bounded IMAP sync. Concurrent calls share one run; never throws. */
export function runEmailSync(): Promise<SyncResult> {
  if (inFlight) return inFlight;
  inFlight = doSync().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function doSync(): Promise<SyncResult> {
  const started = Date.now();
  const { user, pass } = emailCredentials();
  if (!user || !pass) {
    const msg = "No email credentials configured.";
    const r: SyncResult = { ok: false, attempted: 0, stored: 0, error: msg, errorKind: "auth", durationMs: Date.now() - started };
    setSyncError(new Date().toISOString(), msg);
    return r;
  }

  const timeout = new Promise<SyncResult>((resolve) =>
    setTimeout(
      () =>
        resolve({
          ok: false,
          attempted: 0,
          stored: 0,
          error: `IMAP sync timed out after ${SYNC_BUDGET_MS / 1000}s.`,
          errorKind: "timeout",
          durationMs: SYNC_BUDGET_MS,
        }),
      SYNC_BUDGET_MS
    )
  );

  const work = (async (): Promise<SyncResult> => {
    const client = new ImapFlow({
      host: HOST,
      port: PORT,
      secure: true,
      auth: { user, pass },
      logger: false,
      connectionTimeout: 15_000,
      tls: { rejectUnauthorized: true },
    });
    let processed = 0;
    let connected = false;
    try {
      await client.connect();
      connected = true;
      const lock = await client.getMailboxLock("INBOX");
      try {
        const mailbox = await client.mailboxOpen("INBOX");
        const total = mailbox.exists;
        const first = Math.max(1, total - MAX_FETCH + 1);
        const range = `${first}:${total}`;
        for await (const msg of client.fetch(
          range,
          { uid: true, envelope: true, flags: true, internalDate: true, source: true },
          { uid: true }
        )) {
          const parsed = parseMessage(msg as unknown as RawMessage);
          if (!parsed) continue;
          const scored = scoreEmail(parsed);
          const verdict =
            scored.band === "Low" ? "safe" : scored.band === "Medium" ? "suspect" : "phish";
          upsertEmail({
            message_id: parsed.id,
            subject: parsed.subject || "(no subject)",
            sender: parsed.from || "(unknown sender)",
            date: parsed.date || "",
            body_snippet: snippet(parsed.body),
            flags: Array.isArray(msg.flags) ? (msg.flags as string[]) : [],
            score: scored.score,
            band: scored.band,
            verdict,
            elite: eliteAssessment(parsed),
            explanation: scored.explanation,
          });
          processed++;
        }
      } finally {
        lock.release();
      }
      const result: SyncResult = {
        ok: true,
        attempted: processed,
        stored: processed,
        durationMs: Date.now() - started,
      };
      setSyncOk(new Date().toISOString(), processed);
      return result;
    } catch (e) {
      const raw = String((e as Error)?.message ?? e).replace(c.pass, "[redacted]");
      const isAuth = /auth|login|credentials/i.test(raw);
      const error = isAuth ? "AUTH failed — bad app password" : `IMAP sync failed: ${raw.slice(0, 200)}`;
      setSyncError(new Date().toISOString(), error);
      return {
        ok: false,
        attempted: processed,
        stored: 0,
        error,
        errorKind: isAuth ? "auth" : "network",
        durationMs: Date.now() - started,
      };
    } finally {
      if (connected) {
        try {
          await client.logout();
        } catch {
          /* already gone — fine */
        }
      }
    }
  })();

  return Promise.race([timeout, work]);
}

/* ------------------------------------------------------------------ */
/* Minimal RFC-5322 / MIME parsing (headers, text body, links, files)  */
/* ------------------------------------------------------------------ */

interface RawMessage {
  uid: number;
  envelope?: { date?: string | Date; subject?: string; from?: { name?: string; address?: string }[]; messageId?: string };
  flags?: string[];
  internalDate?: Date | string;
  source?: Buffer;
}

function parseMessage(msg: RawMessage): ParsedEmail | null {
  const raw = msg.source;
  if (!raw) return null;
  const text = raw.toString("utf8");
  const headEnd = text.indexOf("\r\n\r\n");
  const sep = headEnd >= 0 ? "\r\n\r\n" : "\n\n";
  const idx = text.indexOf(sep);
  if (idx < 0) return null;
  const headerBlock = text.slice(0, idx);
  const bodyBlock = text.slice(idx + sep.length);

  const headers = parseHeaders(headerBlock);
  const fromHeader = decodeHeader(headers.get("from") || "");
  const subjectHeader = decodeHeader(headers.get("subject") || "");
  const messageIdHeader = (headers.get("message-id") || "").trim();
  const dateHeader = headers.get("date") || "";

  const { text: bodyText, links, attachments } = parseBody(bodyBlock, headers);

  const date =
    safeDateString(msg.envelope?.date) ||
    safeDateString(msg.internalDate) ||
    dateHeader.slice(0, 31);

  // Deterministic fallback (uid only — no timestamp) so repeated syncs dedupe.
  const id = messageIdHeader || (msg.envelope?.messageId || "").trim() || `imap-${msg.uid}`;

  return {
    id,
    from: fromHeader,
    fromDomain: domainOfHeader(fromHeader),
    subject: subjectHeader,
    body: bodyText.slice(0, 6000),
    links,
    attachments,
    date,
  };
}

function parseHeaders(block: string): Map<string, string> {
  const map = new Map<string, string>();
  let current = "";
  let value = "";
  for (const line of block.split(/\r?\n/)) {
    if (/^[ \t]/.test(line)) {
      value += " " + line.trim();
    } else {
      if (current) map.set(current, value);
      const m = line.match(/^([^:]+):\s?(.*)$/);
      if (m) {
        current = m[1].toLowerCase();
        value = m[2];
      } else {
        current = "";
      }
    }
  }
  if (current) map.set(current, value);
  return map;
}

/** Decode RFC 2047 encoded-words (=?utf-8?B?...?= / =?utf-8?Q?...?=). */
function decodeHeader(value: string): string {
  return value
    .replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, (_m, _charset, enc, data) => {
      try {
        if (enc.toLowerCase() === "b") return Buffer.from(data, "base64").toString("utf8");
        return data
          .replace(/_/g, " ")
          .replace(/=([0-9a-fA-F]{2})/g, (_x: string, hex: string) => String.fromCharCode(parseInt(hex, 16)));
      } catch {
        return "";
      }
    })
    .replace(/\s+/g, " ")
    .trim();
}

function domainOfHeader(fromHeader: string): string | undefined {
  const m = fromHeader.match(/<([^>]+)>/);
  const addr = (m ? m[1] : fromHeader).trim().toLowerCase();
  const at = addr.lastIndexOf("@");
  if (at < 0) return undefined;
  return addr.slice(at + 1);
}

function safeDateString(d: unknown): string {
  if (d instanceof Date && !isNaN(d.getTime())) return d.toISOString();
  if (typeof d === "string" && d) {
    const t = new Date(d);
    return isNaN(t.getTime()) ? d : t.toISOString();
  }
  return "";
}

function snippet(body: string): string {
  const clean = body.replace(/\s+/g, " ").trim();
  return clean.length > 260 ? clean.slice(0, 260) + "…" : clean;
}

/** Walks the MIME body for the first text alternative, links, and attachments. */
function parseBody(
  body: string,
  headers: Map<string, string>
): { text: string; links: string[]; attachments: string[] } {
  const links: string[] = [];
  const attachments: string[] = [];
  const ctype = (headers.get("content-type") || "text/plain").toLowerCase();
  const cte = (headers.get("content-transfer-encoding") || "").toLowerCase().trim();

  if (!ctype.includes("multipart/")) {
    const decoded = decodeBody(body, cte);
    return { text: cleanText(decoded, ctype, links), links, attachments };
  }

  // naive multipart split (good enough for text/plain + text/html + attachments)
  const boundaryMatch = ctype.match(/boundary="?([^";]+)"?/);
  if (!boundaryMatch) return { text: cleanText(body, "text/plain", links), links, attachments };
  const boundary = boundaryMatch[1];
  const parts = body.split(`--${boundary}`);
  let text = "";
  for (const part of parts) {
    const pidx = part.indexOf("\r\n\r\n");
    const phead = pidx >= 0 ? part.slice(0, pidx) : "";
    const pbody = pidx >= 0 ? part.slice(pidx + 4) : part;
    const pct = (phead.match(/content-type:\s*([^\r\n]+)/i)?.[1] || "text/plain").toLowerCase();
    const pcte = (phead.match(/content-transfer-encoding:\s*([^\r\n]+)/i)?.[1] || "").toLowerCase().trim();
    const disposition = phead.toLowerCase().includes("content-disposition: attachment");
    const filename = phead.match(/filename="?([^";]+)"?/i)?.[1];
    if (disposition && filename) {
      attachments.push(filename);
      continue;
    }
    if (pct.includes("text/plain") && !text) {
      text = decodeBody(pbody, pcte);
    } else if (pct.includes("text/html") && !text) {
      text = decodeBody(pbody, pcte);
    }
  }
  return { text: cleanText(text, "text/plain", links), links, attachments };
}

function decodeBody(body: string, cte: string): string {
  if (cte.includes("base64")) {
    try {
      return Buffer.from(body.replace(/\s+/g, ""), "base64").toString("utf8");
    } catch {
      return body;
    }
  }
  if (cte.includes("quoted-printable")) {
    return body
      .replace(/=([0-9a-fA-F]{2})/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/=\r?\n/g, "");
  }
  return body;
}

function cleanText(raw: string, contentType: string, links: string[]): string {
  const isHtml = contentType.includes("html");
  let t = raw;
  if (isHtml) {
    for (const m of t.matchAll(/href="([^"]+)"/gi)) {
      const u = m[1];
      if (/^https?:\/\//i.test(u)) links.push(u);
    }
    t = t
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/&quot;/gi, '"');
  } else {
    for (const m of t.matchAll(/https?:\/\/[^\s<>"']+/g)) links.push(m[0]);
  }
  return t.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}
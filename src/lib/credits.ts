// Deep-lookup credit ledger — the deliverable of the $10 "Report extras" tier.
//
// One JSON file per identity at <data>/credits/<identityKey>.json storing
// { credits, history }. Identity uses the SAME cookie + IP scheme as the free
// report quota (src/lib/rate.ts): the i3v cookie is the primary key, the IP is
// the fallback. A completed $10 PayPal capture grants +1 credit to the
// purchasing identity (see routes/api/paypal/order/$orderID/capture.tsx); a deep
// scan consumes exactly 1 credit when it starts.
//
// Grants are idempotent per order id, so re-running a capture can never mint
// two credits from one payment. Consumes are a synchronous read-modify-write on
// the identity's file (the sandbox server is single-process), so a double click
// cannot spend the same credit twice.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { COOKIE_NAME, ipKey } from "./rate";

const ROOT = process.env.INTEGRITY_DATA_DIR ?? "/home/team/shared/data";
const creditsDir = () => join(ROOT, "credits");

export interface CreditEntry {
  at: string;
  kind: "grant-order" | "consume-deep-scan" | "adjust";
  orderId?: string;
  reportId?: string;
  targetUrl?: string;
  note?: string;
}

export interface CreditLedger {
  credits: number;
  history: CreditEntry[];
}

/** Visitor identity key — mirrors the free-report quota keying in rate.ts. */
export function identityKey(req: Request): string {
  const cookie = parseCookie(req.headers.get("cookie") ?? "")[COOKIE_NAME];
  return cookie ? `c:${cookie}` : `k:${ipKey(req)}`;
}

function parseCookie(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx > 0) {
      const k = part.slice(0, idx).trim();
      const v = part.slice(idx + 1).trim();
      if (k) out[k] = decodeURIComponent(v);
    }
  }
  return out;
}

function ledgerPath(key: string): string {
  // Keys are hex hashes / uuid-v4 / short prefixes — safe as filenames.
  return join(creditsDir(), `${key}.json`);
}

export function readLedger(key: string): CreditLedger {
  const path = ledgerPath(key);
  try {
    if (existsSync(path)) {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<CreditLedger>;
      const credits = typeof parsed.credits === "number" && parsed.credits >= 0 ? parsed.credits : 0;
      const history = Array.isArray(parsed.history) ? (parsed.history as CreditEntry[]) : [];
      return { credits, history };
    }
  } catch {
    // corrupt or unreadable ledger → treat as empty; a fresh ledger is honest.
  }
  return { credits: 0, history: [] };
}

function writeLedger(key: string, ledger: CreditLedger): void {
  try {
    mkdirSync(creditsDir(), { recursive: true, mode: 0o775 });
    writeFileSync(ledgerPath(key), JSON.stringify(ledger, null, 2), "utf8");
  } catch {
    // A failed ledger write must not break a scan; the credit is best-effort.
  }
}

/** Balance for the current visitor (server side — reads the request). */
export function getCreditBalance(req: Request): { key: string; credits: number } {
  const key = identityKey(req);
  return { key, credits: readLedger(key).credits };
}

/** Grant +1 credit for a COMPLETED $10 order. Idempotent per order id. */
export function grantCreditForOrder(
  key: string,
  orderId: string,
  meta: { targetUrl?: string; note?: string } = {}
): CreditLedger {
  const ledger = readLedger(key);
  const alreadyGranted = ledger.history.some(
    (h) => h.kind === "grant-order" && h.orderId === orderId
  );
  if (alreadyGranted) return ledger; // one payment, one credit — never double-grant
  ledger.credits += 1;
  ledger.history.push({
    at: new Date().toISOString(),
    kind: "grant-order",
    orderId,
    targetUrl: meta.targetUrl,
    note: meta.note,
  });
  writeLedger(key, ledger);
  return ledger;
}

/** Consume 1 credit to start a deep scan. Returns ok=false (with reason) when
 *  the visitor has no credit — the caller must not start the scan then. */
export function consumeCredit(
  key: string,
  meta: { reportId?: string; targetUrl?: string } = {}
): { ok: boolean; credits: number; reason?: string } {
  const ledger = readLedger(key);
  if (ledger.credits < 1) {
    return {
      ok: false,
      credits: 0,
      reason: "You don't have a deep-lookup credit. The $10 tier (test mode) includes one.",
    };
  }
  ledger.credits -= 1;
  ledger.history.push({
    at: new Date().toISOString(),
    kind: "consume-deep-scan",
    reportId: meta.reportId,
    targetUrl: meta.targetUrl,
  });
  writeLedger(key, ledger);
  return { ok: true, credits: ledger.credits };
}
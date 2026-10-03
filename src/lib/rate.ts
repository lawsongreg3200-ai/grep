// Soft per-visitor free tier (owner decision 2026-09-06): 1 full free report
// PER VISITOR, lifetime (not per day). Visitor identity = cookie + IP fallback.
// Soft limit, stated honestly in the UI — never a paywall teaser. Viewing an
// already-created report is always free and fully visible.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
export const FREE_LIMIT = 1;
export const COOKIE_NAME = "i3v";
export const LIMIT_MESSAGE =
  "You've used your 1 free report. Paid plans are coming soon.";
const ROOT = process.env.INTEGRITY_DATA_DIR ?? "/home/team/shared/data";
const usageDir = () => join(ROOT, "usage");
const usageFile = () => join(usageDir(), "usage.json");
interface UsageEntry {
  cookie: string | null;
  count: number;
  lastAt: string;
}
type UsageMap = Record<string, UsageEntry>;
function readUsage(): UsageMap {
  // Legacy: pre-2026-09-08 per-day files (3/day). Fold them in — any entry
  // with count >= 1 has used the new lifetime free report.
  const legacy: UsageMap = {};
  try {
    for (const name of readdirSync(usageDir())) {
      if (!/^\d{4}-\d{2}-\d{2}\.json$/.test(name)) continue;
      const parsed = JSON.parse(readFileSync(join(usageDir(), name), "utf8"));
      if (parsed && typeof parsed === "object") {
        for (const [k, v] of Object.entries(parsed as Record<string, UsageEntry>)) {
          if (v && typeof v.count === "number" && v.count >= 1) {
            legacy[k] = { cookie: v.cookie ?? null, count: 1, lastAt: v.lastAt ?? "" };
          }
        }
      }
    }
  } catch {
    // empty or unreadable legacy dir — fine
  }
  try {
    const p = usageFile();
    if (!existsSync(p)) return legacy;
    const parsed = JSON.parse(readFileSync(p, "utf8"));
    const current = parsed && typeof parsed === "object" ? (parsed as UsageMap) : {};
    return { ...legacy, ...current };
  } catch {
    return legacy;
  }
}
function writeUsage(data: UsageMap) {
  try {
    mkdirSync(usageDir(), { recursive: true, mode: 0o775 });
    writeFileSync(usageFile(), JSON.stringify(data), "utf8");
  } catch {
    // soft limit is best-effort; never fail a scan because usage tracking failed
  }
}
export function ipKey(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  const ip = (fwd ?? "").split(",")[0]?.trim() || "unknown";
  return createHash("sha1").update(`ip:${ip}`).digest("hex").slice(0, 12);
}
/**
 * Check whether this visitor may start a NEW scan. Returns a decision plus the
 * visitor id to persist in a cookie. soft=true means "over the free limit"
 * rather than an error (invalid input is still the caller's job).
 */
export function checkAndConsume(req: Request): {
  allowed: boolean;
  reason?: string;
  remaining: number;
  cookieValue?: string;
} {
  const cookieId = parseCookie(req.headers.get("cookie") ?? "")[COOKIE_NAME];
  const ip = ipKey(req);
  // Visitor identity = cookie + IP. A visitor without a cookie is keyed by IP;
  // with a cookie, the cookie is the primary key and the IP tally is a
  // fallback so clearing cookies (or a first scan done before the cookie was
  // set) does not reset the limit.
  let primary: string;
  if (cookieId) {
    primary = `c:${cookieId}`;
  } else {
    primary = `k:${ip}`;
  }
  const usage = readUsage();
  const cookieEntry: UsageEntry = cookieId
    ? (usage[`c:${cookieId}`] ?? { cookie: cookieId, count: 0, lastAt: "" })
    : { cookie: null, count: 0, lastAt: "" };
  const ipEntry: UsageEntry = usage[`k:${ip}`] ?? { cookie: null, count: 0, lastAt: "" };
  const used = Math.max(cookieEntry.count, ipEntry.count);
  const remaining = Math.max(0, FREE_LIMIT - used);
  if (used >= FREE_LIMIT) {
    return {
      allowed: false,
      reason: LIMIT_MESSAGE,
      remaining: 0,
    };
  }
  // Consume the one free slot on this visitor's primary identity.
  usage[primary] = {
    cookie: cookieId ?? null,
    count: used + 1,
    lastAt: new Date().toISOString(),
  };
  writeUsage(usage);

  const newVisitor = !cookieId;
  const value = cookieId ?? randomUUID();
  return { allowed: true, remaining: Math.max(0, FREE_LIMIT - (used + 1)), cookieValue: newVisitor ? value : undefined };
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
export function cookieHeader(value: string): string {
  return `${COOKIE_NAME}=${encodeURIComponent(value)}; Path=/; SameSite=Lax; Max-Age=31536000`;
}
/** How many free reports this visitor has already used (for display). */
export function usedTotal(req: Request): number {
  const cookieId = parseCookie(req.headers.get("cookie") ?? "")[COOKIE_NAME];
  const ip = ipKey(req);
  const usage = readUsage();
  const cookieCount = cookieId ? (usage[`c:${cookieId}`]?.count ?? 0) : 0;
  const ipCount = usage[`k:${ip}`]?.count ?? 0;
  return Math.max(cookieCount, ipCount);
}
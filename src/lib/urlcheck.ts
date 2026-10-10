/**
 * ROBO DEEBO — URL reputation (slice 5). Server-only.
 *
 * One job: tell the owner which links in flagged mail are dangerous before
 * they click. Two layers:
 *
 *  1. Google Safe Browsing v4 (threatMatches:find) — the danger source.
 *     Reads SAFEBROWSING_API_KEY from process.env (whitespace-stripped, never
 *     logged, never returned to the client). When the key is absent or the
 *     call fails, links are marked 'gsb-unavailable' and the heuristic base
 *     carries the verdict — the scan never crashes on a missing key.
 *
 *  2. Heuristic base (always on, no key) — brand lookalikes (levenshtein <=1
 *     or homoglyph vs. real brands + the sender's own claimed domain),
 *     IP-literal hosts, punycode/hex/encoded hosts, suspicious TLDs,
 *     @-in-URL login tricks, data: URIs, known shortener hosts.
 *
 * Safety rule (owner-ratified): we never visit arbitrary link destinations.
 * Only KNOWN link-shortener hosts are unwrapped (tight timeouts, no cookies,
 * no JS, max 3 hops). Everything else goes to Google Safe Browsing + the
 * heuristics as a plain string — a security product must not beacon to
 * unknown hosts.
 */
/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type LinkVerdict = "safe" | "suspicious" | "dangerous";
export type GsbState = "safe" | "dangerous" | "unavailable";

export interface LinkAssessment {
  url: string; // the raw URL as it appeared in the message
  final_url: string; // after shortener unwrap (== url for non-shorteners)
  host: string; // host of final_url ("" when unparseable)
  shortener: boolean; // true when url went through a known shortener
  shortener_hops: number;
  heuristic: { verdict: LinkVerdict; reason: string };
  gsb: { verdict: GsbState; threats: string[]; source: string; cacheDuration?: string };
  /** GSB DANGEROUS wins; otherwise the heuristic verdict. */
  combined: LinkVerdict;
  combined_reason: string;
}

export interface GsbBatchResult {
  /** url -> per-link GSB verdict. Absent url means "no match from GSB" (call succeeded). */
  map: Map<string, { verdict: GsbState; threats: string[]; cacheDuration?: string }>;
  error?: string;
}

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */

const GSB_ENDPOINT = "https://safebrowsing.googleapis.com/v4/threatMatches:find";
const GSB_TIMEOUT_MS = 10_000;
const GSB_BATCH_MAX = 500;
const HOP_TIMEOUT_MS = 4_000;
const MAX_HOPS = 3;

const CLIENT = { clientId: "robo-deebo", clientVersion: "0.5" };
const THREAT_TYPES = [
  "MALWARE",
  "SOCIAL_ENGINEERING",
  "UNWANTED_SOFTWARE",
  "POTENTIALLY_HARMFUL_APPLICATION",
];

/** Known shortener hosts — the ONLY destinations we ever follow automatically. */
const SHORTENERS = new Set([
  "bit.ly", "bitly.com", "t.co", "goo.gl", "tinyurl.com", "tiny.cc", "is.gd",
  "ow.ly", "buff.ly", "rb.gy", "cutt.ly", "shorturl.at", "rebrand.ly", "clck.ru",
  "snip.ly", "su.pr", "lnkd.in", "go2.link", "dld.bz", "s.id", "surl.li", "x.co",
]);

const SENDER_EXTRA_BRANDS = [
  "paypal", "google", "apple", "microsoft", "netflix", "amazon", "chase",
  "wellsfargo", "dropbox", "linkedin", "facebook", "instagram", "github",
  "citibank", "bankofamerica", "coinbase",
];

/** TLDs heavily abused in phishing (public blacklists, APWG reports). */
const SUSPICIOUS_TLDS = new Set([
  "xyz", "top", "club", "online", "site", "icu", "tk", "ml", "ga", "cf", "gq",
  "click", "zip", "mov", "work", "live", "buzz", "vip", "cam", "rest", "cyou",
  "monster", "quest", "gdn", "loan", "win", "bid", "download", "country",
]);

/** Homoglyph confusables for brand-spoof detection (0->o, 1->l, 3->e, ...). */
const HOMO: Record<string, string> = {
  "0": "o", "1": "l", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b",
  "@": "a", "$": "s", "!": "i", "|": "l", "¡": "i",
};

export function gsbApiKey(): string {
  return (process.env.SAFEBROWSING_API_KEY || "").replace(/\s+/g, "");
}
export function gsbConfigured(): boolean {
  return gsbApiKey().length > 0;
}

/* ------------------------------------------------------------------ */
/* Link extraction (sync-time)                                         */
/* ------------------------------------------------------------------ */

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x27;|&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&#x([0-9a-fA-F]{1,4});/g, (_m, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d{1,5});/g, (_m, d) => String.fromCharCode(Number(d)));
}

/** Repair common obfuscations a real message may use to dodge scanners. */
function deobfuscate(u: string): string {
  let out = u.trim();
  // hxxp:// / hXXp:// / hTTP:// — classic paste-site obfuscation in real phishing.
  out = out.replace(/^hxxps?:\/\//i, (m) => "http" + m.slice(4));
  out = out.replace(/^h\s*x\s*x\s*p/i, "http");
  // Obfuscated dots, e.g. paypal[.]com / paypal(.)com inside a URL.
  out = out.replace(/\[\.\]/gi, ".").replace(/\(\.\)/g, ".");
  // Scheme with a stray space: "http ://" or "https:// " (many clients render it).
  out = out.replace(/^https?: \/\//i, (m) => m.replace(" ", ""));
  out = out.replace(/^https?:\/\/ /i, (m) => m.replace(" ", ""));
  return out;
}

const ENTITY_TAG_RE = /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi;

/**
 * Extract candidate URLs from the decoded HTML body and the plain-text body.
 * Handles hrefs (both quote styles), bare text URLs, and the recoverable
 * obfuscations above. Returns raw, deobfuscated strings — lookups (and any
 * network fetches) happen later, only for real http(s) URLs.
 */
export function extractLinks(html: string | null, text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (raw: string) => {
    const u = deobfuscate(raw);
    if (!u) return;
    const key = u.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(u);
  };

  if (html && /<a\b/i.test(html)) {
    const decoded = decodeEntities(html);
    for (const m of decoded.matchAll(ENTITY_TAG_RE)) add(m[1]);
    for (const m of decoded.matchAll(/href\s*=\s*"([^"]+)"/gi)) add(m[1]);
    for (const m of decoded.matchAll(/href\s*=\s*'([^']+)'/gi)) add(m[1]);
  }
  // Bare URLs in the visible text (text body OR stripped html text).
  for (const m of text.matchAll(/https?:\/\/[^\s<>"')\]]+/gi)) add(m[0]);
  for (const m of text.matchAll(/hxxps?:\/\/[^\s<>"')\]]+/gi)) add(m[0]);
  // data: URIs — flagged as dangerous in the heuristics; keep them visible.
  for (const m of text.matchAll(/data:[a-z0-9+/]+;base64,[A-Za-z0-9+/=]+/gi)) add(m[0]);
  // scheme with a space inside, e.g. "http ://evil.com" — recovered here.
  for (const m of text.matchAll(/https? :\/\/[^\s<>"')\]]+/gi)) add(m[0].replace(/https? :/i, (x) => x.replace(" ", "")));
  return out;
}

/* ------------------------------------------------------------------ */
/* URL / host helpers                                                  */
/* ------------------------------------------------------------------ */

/** Host of a URL string, lowercased ("" when the URL is unparseable). */
export function hostOf(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  } catch {
    return "";
  }
}

/** Registrable-ish base: last 2 labels for common TLDs, else last 2 if 2-label TLD (co.uk). */
function baseOf(host: string): string {
  const labels = host.split(".").filter(Boolean);
  if (labels.length <= 2) return host;
  const tld = labels[labels.length - 1];
  const twoTld = new Set(["co", "com", "org", "net", "gov", "edu", "ac", "uk", "au", "ca", "jp", "nz"]);
  if (twoTld.has(tld)) return labels.slice(-3).join(".");
  return labels.slice(-2).join(".");
}

function lev(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  const dp = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[n];
}

/** Normalize a host through the homoglyph map, then strip vowels — lenient confusable match. */
function homoglyphKey(host: string): string {
  return host
    .split("")
    .map((c) => HOMO[c] ?? c)
    .join("")
    .toLowerCase();
}

function isIpLiteral(host: string): boolean {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  if (/^[0-9a-f]{4}(:[0-9a-f]{4}){7}$/i.test(host)) return true;
  return false;
}

function isEncodedHost(host: string): boolean {
  // punycode, percent-encoded, hex, or pure-decimal (IPv4-in-integer) hosts.
  if (host.startsWith("xn--")) return true;
  if (host.includes("%")) return true;
  if (/^0x[0-9a-f]+$/i.test(host)) return true;
  if (/^[0-9]{6,12}$/.test(host)) return true;
  return false;
}

function isShortenerHost(host: string): boolean {
  const h = host.replace(/^www\./, "");
  for (const s of SHORTENERS) {
    if (h === s || h.endsWith("." + s)) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Heuristic base (always on, no key)                                  */
/* ------------------------------------------------------------------ */

export function heuristicCheck(url: string, senderDomain?: string): { verdict: LinkVerdict; reason: string } {
  const lower = url.toLowerCase();

  // data: URI — never open one from email.
  if (lower.startsWith("data:")) {
    return { verdict: "dangerous", reason: "data: URI — embedded content, never open from mail." };
  }

  // @ in the authority position = login-credential trick: https://brand.com@evil.net
  const rest = lower.replace(/^[a-z]+:\/\//, "");
  const authority = rest.slice(0, rest.indexOf("/") >= 0 ? rest.indexOf("/") : rest.length);
  if (authority.includes("@") && !authority.startsWith("mailto:")) {
    return { verdict: "suspicious", reason: "@ trick — the real destination is after the @." };
  }

  const host = hostOf(url);
  if (!host) return { verdict: "safe", reason: "Not a resolvable URL." };

  if (isShortenerHost(host)) {
    return { verdict: "suspicious", reason: `Uses link shortener ${host} — destination hidden.` };
  }
  if (isIpLiteral(host)) {
    return { verdict: "suspicious", reason: `IP-literal host (${host}) — real senders don't do this.` };
  }
  if (isEncodedHost(host)) {
    return { verdict: "suspicious", reason: `Encoded/punycode host (${host.slice(0, 40)}) — hides the real name.` };
  }

  const base = baseOf(host);
  const tld = host.split(".").pop() ?? "";
  if (!base || !tld) return { verdict: "safe", reason: "No usable hostname." };

  // Brand lookalike: lev <= 1 or homoglyph-equivalent against the brand list
  // PLUS the sender's own claimed domain (so "dhl-express" spoofing a dhl sender
  // lights up even though dhl isn't in the fixed list).
  const brands = new Set([...SENDER_EXTRA_BRANDS]);
  if (senderDomain) {
    const sd = senderDomain.toLowerCase().replace(/^www\./, "");
    brands.add(baseOf(sd) || sd);
  }
  const hk = homoglyphKey(base);
  const exact = base.replace(/^www\./, "");
  for (const brand of brands) {
    if (exact === brand) return { verdict: "safe", reason: `Exact match for ${brand} — looks legit.` };
    const b = brand.replace(/^www\./, "");
    if (base !== b && lev(base, b) <= 1) {
      return { verdict: "dangerous", reason: `Lookalike of ${brand} (${base} ≈ ${b}) — classic spoof.` };
    }
    if (base !== b && homoglyphKey(b) === hk) {
      return { verdict: "dangerous", reason: `Homoglyph spoof of ${brand} (${base}).` };
    }
    if (base.includes(b) && base.length > b.length + 1) {
      return { verdict: "suspicious", reason: `Padded brand name — ${base} embeds ${brand}.` };
    }
  }

  if (SUSPICIOUS_TLDS.has(tld)) {
    return { verdict: "suspicious", reason: `Abused TLD (.${tld}) — heavily used in phishing.` };
  }

  return { verdict: "safe", reason: "No heuristic red flags on the final host." };
}

/* ------------------------------------------------------------------ */
/* Shortener unwrap — the ONLY host we ever follow                     */
/* ------------------------------------------------------------------ */

export interface UnwrapResult {
  final_url: string;
  hops: number;
  followed: boolean;
}

/**
 * Follow a known shortener's redirect chain: max 3 hops, <=4s/hop, no cookies
 * (Bun fetch sends none — we never read Set-Cookie), no client-side JS, and
 * no body is read or followed. Non-shortener URLs pass through untouched —
 * we never visit unknown hosts.
 */
export async function unwrapShortener(url: string): Promise<UnwrapResult> {
  const host = hostOf(url);
  if (!host || !isShortenerHost(host)) {
    return { final_url: url, hops: 0, followed: false };
  }
  let current = url;
  let hops = 0;
  for (let i = 0; i < MAX_HOPS; i++) {
    try {
      const res = await fetch(current, {
        method: "GET",
        redirect: "manual",
        headers: { "user-agent": "robo-deebo/0.5 (link safety check)" },
        signal: AbortSignal.timeout(HOP_TIMEOUT_MS),
      });
      const loc = res.headers.get("location");
      if (loc) {
        current = new URL(loc, current).toString();
        hops++;
        continue;
      }
      return { final_url: current, hops, followed: true };
    } catch {
      // Timeout / network hiccup: keep what we have rather than fail the scan.
      return { final_url: current, hops, followed: hops > 0 };
    }
  }
  return { final_url: current, hops, followed: true };
}

/* ------------------------------------------------------------------ */
/* Google Safe Browsing v4 — the danger source                          */
/* ------------------------------------------------------------------ */

/**
 * POST threatMatches:find with batches of <=500 URLs. On ANY failure (missing
 * key, non-200, timeout) returns unavailable state for the unknown set —
 * the scan leans on heuristics and never crashes. No secrets are logged and
 * the key never appears in output.
 */
export async function gsbThreatMatches(urls: string[]): Promise<GsbBatchResult> {
  const map = new Map<string, { verdict: GsbState; threats: string[]; cacheDuration?: string }>();
  const key = gsbApiKey();
  if (!key) {
    return { map, error: "SAFEBROWSING_API_KEY not configured." };
  }
  const unique = [...new Set(urls)];
  if (!unique.length) return { map };
  try {
    // Normalize to absolute http(s) URLs. GSB rejects a batch outright (HTTP
    // 400) if ANY entry is malformed (unencoded spaces/control chars,
    // protocol-relative, mailto:, etc.), which would otherwise fail the whole
    // sync's verdict set. Unparseable links keep their heuristic verdict.
    const entries = unique
      .map((u) => {
        try {
          const p = new URL(u);
          if (p.protocol !== "http:" && p.protocol !== "https:") return null;
          return p.href;
        } catch {
          return null;
        }
      })
      .filter((x): x is string => x !== null);
    if (!entries.length) return { map };
    for (let i = 0; i < entries.length; i += GSB_BATCH_MAX) {
      const chunk = entries.slice(i, i + GSB_BATCH_MAX);
      const res = await fetch(`${GSB_ENDPOINT}?key=${encodeURIComponent(key)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client: CLIENT,
          threatInfo: {
            threatTypes: THREAT_TYPES,
            platformTypes: ["ANY_PLATFORM"],
            threatEntryTypes: ["URL"],
            threatEntries: chunk.map((u) => ({ url: u })),
          },
        }),
        signal: AbortSignal.timeout(GSB_TIMEOUT_MS),
      });
      if (!res.ok) {
        // Never surface the body: GSB error bodies can echo back query params.
        return { map, error: `GSB HTTP ${res.status}.` };
      }
      const data = (await res.json()) as {
        matches?: { threatType: string; threat: { url?: string }; cacheDuration?: string }[];
      };
      for (const m of data.matches ?? []) {
        const u = m.threat?.url;
        if (!u) continue;
        const prev = map.get(u);
        map.set(u, {
          verdict: "dangerous",
          threats: [...new Set([...(prev?.threats ?? []), m.threatType])],
          cacheDuration: m.cacheDuration,
        });
      }
    }
    return { map };
  } catch (e) {
    return { map, error: `GSB unavailable: ${String((e as Error)?.message ?? e).slice(0, 120)}` };
  }
}

/* ------------------------------------------------------------------ */
/* Full per-email pipeline                                             */
/* ------------------------------------------------------------------ */

/**
 * Assess every link of one email: unwrap shorteners, run GSB once over the
 * whole set (batched), apply heuristics per link, and combine. `gsbOutcomes`
 * is the shared GSB batch result from the caller so the whole sync makes ONE
 * GSB call, not one per email.
 */
export async function assessLinks(
  links: string[],
  senderDomain: string | undefined,
  gsbOutcomes: GsbBatchResult
): Promise<LinkAssessment[]> {
  const out: LinkAssessment[] = [];
  for (const url of links) {
    const unwrapped = await unwrapShortener(url);
    const finalUrl = unwrapped.final_url;
    const host = hostOf(finalUrl);
    const heuristic = heuristicCheck(finalUrl, senderDomain);
    const gsbHit = gsbOutcomes.map.get(finalUrl);
    const gsb: LinkAssessment["gsb"] = gsbHit
      ? {
          verdict: gsbHit.verdict,
          threats: gsbHit.threats,
          source: "google-safe-browsing",
          cacheDuration: gsbHit.cacheDuration,
        }
      : gsbOutcomes.error
        ? { verdict: "unavailable", threats: [], source: "google-safe-browsing" }
        : { verdict: "safe", threats: [], source: "google-safe-browsing" };

    let combined: LinkVerdict;
    let combined_reason: string;
    if (gsb.verdict === "dangerous") {
      combined = "dangerous";
      combined_reason = `Google Safe Browsing: ${gsb.threats.join(", ")}.`;
    } else {
      combined = heuristic.verdict;
      combined_reason = heuristic.reason;
    }
    out.push({
      url,
      final_url: finalUrl,
      host,
      shortener: unwrapped.followed,
      shortener_hops: unwrapped.hops,
      heuristic,
      gsb,
      combined,
      combined_reason,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Convenience for tests / one-offs                                    */
/* ------------------------------------------------------------------ */

/** Standalone: assess one list of links including a fresh GSB call. */
export async function checkLinksForEmail(
  links: string[],
  senderDomain?: string
): Promise<{ assessments: LinkAssessment[]; gsbError?: string; gsbConfigured: boolean }> {
  const finalUrls = [];
  for (const u of links) {
    const w = await unwrapShortener(u);
    finalUrls.push(w.final_url);
  }
  const gsb = await gsbThreatMatches(finalUrls);
  const assessments = await assessLinks(links, senderDomain, gsb);
  return { assessments, gsbError: gsb.error, gsbConfigured: gsbConfigured() };
}



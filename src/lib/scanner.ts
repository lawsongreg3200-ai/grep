// Scanner engine v1 — deterministic, rule-based, no LLM.
// Refuses to invent findings: Pass only with deterministic positive evidence,
// Fail only on a directly observed contradiction, everything else Unknown.


import type {
  CheckResult,
  ClaimSpot,
  Confidence,
  Finding,
  Report,
  ScanOptions,
  ScanProgress,
  SourceRef,
} from "./types";

import { DEEP_METHOD_SUFFIX, METHOD_VERSION, SCAN_STEPS } from "./meta";

function cryptoRandomId(len = 12): string {
  // 12-char lowercase alphanumeric id. Previously a Date.now()-seeded LCG,
  // which COLLIDED (two scans minutes apart generated the same report id and
  // overwrote each other). Use real randomness: crypto.getRandomValues on
  // server and modern clients; a Math.random fallback otherwise.
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const pick = (): number => {
    const c = globalThis.crypto;
    if (c && typeof c.getRandomValues === "function") {
      const b = new Uint32Array(1);
      c.getRandomValues(b);
      return b[0];
    }
    return Math.floor(Math.random() * 0xffffffff);
  };
  let s = "";
  for (let i = 0; i < len; i++) s += chars[pick() % chars.length];
  return s;
}


const MAX_BYTES = 2 * 1024 * 1024; // 2 MB size cap
const TIMEOUT_MS = 15_000; // 15 s fetch timeout
const MAX_PAGES = 4; // homepage + up to 3 legal/pricing pages
const MAX_PAGES_DEEP = 15; // deep lookup ($10 tier): ~15 pages, incl. discovered links

export type JobStatus = "queued" | "running" | "complete" | "error";

export interface Job {
  id: string;
  status: JobStatus;
  step: string;
  progress: number;
  error?: string;
}

const jobs = new Map<string, Job>();

// ---------- tiny HTML helpers (the scanner runs without a DOM) ----------

function htmlEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#x2F;/gi, "/")
    .replace(/&#\d+;/g, (m) => {
      const n = Number(m.slice(2, -1));
      return Number.isFinite(n) && n > 0 && n < 0x10ffff ? String.fromCodePoint(n) : m;
    });
}

/** Strip tags, unescape entities, collapse whitespace, lowercase-normalize. */
function tokens(html: string): string {
  const raw = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  return htmlEntities(raw)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function condense(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Light text: strips tags/scripts but keeps digits, $, %, dots — for numeric
 *  patterns like "99.9% uptime" or "$10 per month". */
function lightText(html: string): string {
  const raw = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  return htmlEntities(raw).toLowerCase().replace(/\s+/g, " ").trim();
}

/** First match index of an escaped literal in tokenized text. */
function literalIndexInTokens(tokensText: string, phrase: string): number {
  return tokensText.indexOf(phrase.toLowerCase());
}

function snippetAt(tokensText: string, idx: number, radius = 80): string {
  if (idx < 0) {
    const start = Math.max(0, Math.floor(tokensText.length / 2) - radius);
    return condense(tokensText.slice(start, start + radius * 2));
  }
  const start = Math.max(0, idx - radius);
  return condense(tokensText.slice(start, idx + radius * 2));
}

/** Snip context around the first occurrence of any of several phrases. */
function snippetForPhrases(tokensText: string, phrases: string[], radius = 80): string {
  let best = -1;
  let bestPhrase = "";
  for (const phrase of phrases) {
    const norm = phrase.toLowerCase();
    const idx = tokensText.indexOf(norm);
    if (idx >= 0 && (best === -1 || idx < best)) {
      best = idx;
      bestPhrase = norm;
    }
  }
  return snippetAt(tokensText, best, radius);
}

function dedupe<T>(arr: T[], key: (t: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of arr) {
    const k = key(item);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(item);
    }
  }
  return out;
}

// ---------- fetch ----------

const UA =
  "IntegrityAuditor/0.1 (public-source claim checker; +https://000f527219985c9c0022508bb115ec7c.ctonew.app)";

interface FetchOk {
  ok: true;
  html: string;
  finalUrl: string;
  redirected: boolean;
  status: number;
}
interface FetchErr {
  ok: false;
  error: string;
}
type FetchResult = FetchOk | FetchErr;

async function fetchText(url: string, label: string): Promise<FetchResult> {
  let res: Response;
  try {
    res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
    });
  } catch (err) {
    const msg =
      err instanceof Error && err.name === "TimeoutError"
        ? "timed out after 15s"
        : err instanceof Error
          ? err.message
          : String(err);
    return { ok: false, error: `${label}: ${msg}` };
  }

  const ctype = (res.headers.get("content-type") ?? "").toLowerCase();
  if (!ctype.includes("text/html") && !ctype.includes("application/xhtml+xml")) {
    return { ok: false, error: `${label}: not an HTML page (content-type: ${ctype.split(";")[0] || "unknown"})` };
  }

  try {
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > MAX_BYTES) {
      return {
        ok: false,
        error: `${label}: page larger than the 2 MB scan cap (${(buf.byteLength / 1048576).toFixed(1)} MB)`,
      };
    }
    return {
      ok: true,
      html: buf.toString("utf8"),
      finalUrl: res.url || url,
      redirected: res.url !== url,
      status: res.status,
    };
  } catch (err) {
    return { ok: false, error: `${label}: failed to read response (${String(err)})` };
  }
}

// ---------- page model ----------

interface Page {
  url: string;
  html: string;
}

function pageLinks(html: string, base: string): { text: string; href: string }[] {
  const links: { text: string; href: string }[] = [];
  const re = /<a\b[^>]*href=["']([^"']*)["']([^>]*)>([\s\S]*?)<\/a\s*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const rawHref = m[1].trim();
    if (!rawHref || rawHref.startsWith("#")) continue;
    try {
      const u = new URL(rawHref, base);
      if (u.protocol === "http:" || u.protocol === "https:") {
        links.push({ text: condense(m[3].replace(/<[^>]+>/g, " ")).slice(0, 120), href: u.href });
      }
    } catch {
      // skip unparseable hrefs
    }
  }
  return links;
}

// ---------- claim extraction rules ----------

const PRICING_PROMISES = [
  { phrase: "no credit card", claim: 'Pricing promise: "no credit card required"' },
  { phrase: "free forever", claim: 'Pricing promise: "free forever"' },
  { phrase: "100% free", claim: 'Pricing promise: "100% free"' },
  { phrase: "never pay", claim: 'Pricing promise: "never pay"' },
  { phrase: "cancel anytime", claim: 'Pricing promise: "cancel anytime"' },
  { phrase: "no hidden fees", claim: 'Pricing promise: "no hidden fees"' },
];

const METRIC_PATTERNS = [
  /\b\d[\d,.]*\s?(k|m|b|million|billion|thousand)\b/g,
  /\b\d[\d,.]*\s?(percent|%)\b/g,
  /\b\d[\d,.]*\+?\s?(users|customers|teams|companies|downloads|reviews|stars|uptime|requests|messages)\b/g,
];

const TESTIMONIAL_PHRASES = [
  "trusted by",
  "love it",
  "loved by",
  "great product",
  "lifesaver",
  "game changer",
  "would recommend",
  "best tool",
  "best app",
  "best service",
  "5 star",
  "five star",
  "rating of",
  "review from",
  "testimonial",
];

const PRESS_PHRASES = ["as seen in", "featured in", "featured on", "coverage by", "mentioned in", "press", "we were featured"];

const GUARANTEE_PHRASES = [
  "money back",
  "money-back",
  "day guarantee",
  "satisfaction guarantee",
  "full refund",
  "lifetime guarantee",
  "lifetime access",
  "lifetime updates",
  "lifetime license",
  "100% guarantee",
];

const REVIEW_SITES: { token: string; name: string; domains: string[] }[] = [
  { token: "trustpilot", name: "Trustpilot", domains: ["trustpilot.com"] },
  { token: "g2", name: "G2", domains: ["g2.com"] },
  { token: "capterra", name: "Capterra", domains: ["capterra.com"] },
  { token: "producthunt", name: "Product Hunt", domains: ["producthunt.com"] },
  { token: "app store", name: "the Apple App Store", domains: ["apps.apple.com"] },
  { token: "google play", name: "Google Play", domains: ["play.google.com"] },
  { token: "bbb", name: "the Better Business Bureau", domains: ["bbb.org"] },
  { token: "yelp", name: "Yelp", domains: ["yelp.com"] },
];

const SCRIPT_HOST_MAP: [string, string][] = [
  ["google-analytics.com", "Google Analytics (analytics)"],
  ["googletagmanager.com", "Google Tag Manager (tag management)"],
  ["fbevents", "Facebook Pixel (ads/analytics)"],
  ["connect.facebook.net", "Facebook SDK (ads/analytics)"],
  ["adsbygoogle", "Google AdSense (ads)"],
  ["doubleclick.net", "Google DoubleClick (ads)"],
  ["hotjar.com", "Hotjar (behavioral analytics / session replay)"],
  ["fullstory.com", "FullStory (session replay)"],
  ["clarity.ms", "Microsoft Clarity (behavioral analytics)"],
  ["plausible.io", "Plausible (analytics)"],
  ["posthog.com", "PostHog (product analytics)"],
  ["segment.com", "Segment (analytics)"],
  ["amplitude.com", "Amplitude (product analytics)"],
  ["mixpanel.com", "Mixpanel (product analytics)"],
  ["intercom.io", "Intercom (chat/support)"],
  ["crisp.chat", "Crisp (chat/support)"],
  ["zendesk.com", "Zendesk (support)"],
  ["hubspot.com", "HubSpot (marketing/CRM)"],
  ["inspectlet.com", "Inspectlet (session replay)"],
  ["mouseflow.com", "Mouseflow (session replay)"],
  ["luckyorange.com", "Lucky Orange (session replay)"],
  ["crazyegg.com", "Crazy Egg (behavioral analytics)"],
  ["smartlook.com", "Smartlook (session replay)"],
  ["msclarity.com", "Microsoft Clarity (behavioral analytics)"],
  ["newrelic.com", "New Relic (monitoring)"],
  ["datadoghq.com", "Datadog (monitoring)"],
  ["sentry.io", "Sentry (error monitoring)"],
  ["scorecardresearch.com", "Comscore (analytics)"],
  ["taboola.com", "Taboola (ads)"],
  ["outbrain.com", "Outbrain (ads)"],
];

// ---------- finding builders ----------

function makeFinding(
  claim: string,
  status: Finding["status"],
  evidence: string,
  sources: SourceRef[],
  confidence: Confidence,
  category: Finding["category"]
): Finding {
  return { id: cryptoRandomId(), claim, status, evidence, sources, confidence, category };
}

// ---------- scan pipeline ----------

interface ScanPipelineResult {
  report: Report;
  claims: ClaimSpot[];
  snapshot: Record<string, { html: string; fetchedAt: string }>;
}

async function runScan(
  id: string,
  rawUrl: string,
  deep: boolean,
  progress: (index: number, frac: number, step: string) => void
): Promise<ScanPipelineResult> {
  const startedAt = new Date().toISOString();
  const notes: string[] = [];
  const maxPages = deep ? MAX_PAGES_DEEP : MAX_PAGES;
  const methodVersion = deep ? `${METHOD_VERSION}${DEEP_METHOD_SUFFIX}` : METHOD_VERSION;

  // ---- normalize the URL ----
  let targetUrl: string;
  try {
    let u = rawUrl.trim();
    if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
    const parsed = new URL(u);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("unsupported protocol");
    if (!parsed.hostname || !parsed.hostname.includes(".")) throw new Error("not a valid hostname");
    targetUrl = parsed.href;
  } catch {
    return {
      report: buildErrorReport(id, rawUrl, startedAt, `"${rawUrl.slice(0, 120)}" is not a valid http(s) URL.`, methodVersion),
      claims: [],
      snapshot: {},
    };
  }

  progress(0, 0.5, "Resolving target URL");
  const homeResult = await fetchText(targetUrl, "homepage");
  if (!homeResult.ok) {
    return {
      report: buildErrorReport(id, rawUrl, startedAt, homeResult.error, methodVersion),
      claims: [],
      snapshot: {},
    };
  }
  if (homeResult.status >= 400) notes.push(`homepage responded with HTTP ${homeResult.status}`);

  progress(1, 0.4, "Fetching homepage");
  const home: Page = { url: homeResult.finalUrl, html: homeResult.html };
  const pages: Page[] = [home];
  const pagesFetched: Report["pagesFetched"] = [{ url: homeResult.finalUrl, status: homeResult.status }];

  // ---- common legal/pricing paths + homepage links ----
  progress(2, 0.2, "Checking Pricing / Terms / Privacy pages");
  const candidates: { label: "Pricing" | "Terms" | "Privacy" | "Page"; url: string }[] = [];
  const seen = new Set<string>();
  const pushCandidate = (label: "Pricing" | "Terms" | "Privacy" | "Page", u: string) => {
    if (!seen.has(u)) {
      seen.add(u);
      candidates.push({ label, url: u });
    }
  };
  try {
    const base = new URL(home.url);
    for (const [path, label] of [
      ["/pricing", "Pricing"],
      ["/pricing/", "Pricing"],
      ["/plans", "Pricing"],
      ["/terms", "Terms"],
      ["/terms-of-service", "Terms"],
      ["/terms-of-use", "Terms"],
      ["/privacy", "Privacy"],
      ["/privacy-policy", "Privacy"],
    ] as const) {
      pushCandidate(label, new URL(path, base).href);
    }
    for (const link of pageLinks(home.html, home.url)) {
      const p = new URL(link.href).pathname.toLowerCase();
      if (/pricing|price|plans?/.test(p)) pushCandidate("Pricing", link.href);
      else if (/(terms|tos|conditions|legal)/.test(p)) pushCandidate("Terms", link.href);
      else if (/privacy/.test(p)) pushCandidate("Privacy", link.href);
    }
    // Deep lookup: also probe the common informational paths even when the
    // homepage does not link to them (about / FAQ / help / features / refunds).
    if (deep) {
      for (const path of [
        "/about",
        "/about-us",
        "/faq",
        "/help",
        "/features",
        "/contact",
        "/legal",
        "/refund-policy",
        "/refunds",
        "/guarantee",
        "/guarantees",
        "/security",
        "/cookies",
        "/cookie-policy",
        "/reviews",
        "/testimonials",
      ]) {
        pushCandidate("Page", new URL(path, base).href);
      }
    }
  } catch {
    // base URL malformed — common paths will be skipped
  }

  const found = new Set<"Pricing" | "Terms" | "Privacy">();
  for (const c of candidates) {
    if (pages.length >= maxPages) break;
    if (c.label !== "Page" && found.has(c.label)) continue;
    const r = await fetchText(c.url, c.label.toLowerCase());
    if (r.ok && r.status < 400) {
      if (pages.some((p) => p.url === r.finalUrl)) continue; // redirected onto an existing page
      pages.push({ url: r.finalUrl, html: r.html });
      pagesFetched.push({ url: r.finalUrl, status: r.status });
      if (c.label !== "Page") found.add(c.label);
    } else if (r.ok) {
      // HTTP error page (404/5xx) is NOT evidence the page exists — never a Pass.
      notes.push(`${c.label} page responded with HTTP ${r.status} (treated as not found)`);
    } else {
      notes.push(r.error);
    }
  }

  // ---- deep: discover more pages from links on everything fetched so far ----
  if (deep) {
    progress(3, 0, "Fetching discovered pages");
    const interesting =
      /(pricing|price|plans?|terms|tos|conditions|legal|privacy|cookie|policy|about|faq|questions|help|features?|contact|refund|guarantee|warranty|security|disclosure|reviews|testimonials?|product|docs?|documentation|how-it-works|compare|team|mission|press|media|careers?|shipping|blog|news|methodology|method|audit|trust|why|support|status|changelog|updates?|resources?|guides?|learn|insights)/i;
    const nonHtml = /\.(pdf|zip|png|jpe?g|gif|svg|webp|avif|mp4|mp3|css|js|json|xml|txt|docx?|xlsx?|ics|rss)(\?|#|$)/i;
    const queue: { url: string }[] = [];
    const queued = new Set<string>();
    const baseHost = new URL(home.url).hostname.toLowerCase().replace(/^www\./, "");
    const enqueue = (href: string) => {
      try {
        const u = new URL(href);
        const host = u.hostname.toLowerCase().replace(/^www\./, "");
        if (host !== baseHost) return; // same site only
        if (u.protocol !== "https:" && u.protocol !== "http:") return;
        if (nonHtml.test(u.pathname)) return;
        if (!interesting.test(u.pathname.toLowerCase())) return;
        if (queued.has(u.href)) return;
        queued.add(u.href);
        queue.push({ url: u.href });
      } catch {
        // skip unparseable links
      }
    };
    for (const p of pages) for (const link of pageLinks(p.html, p.url)) enqueue(link.href);
    while (pages.length < maxPages && queue.length > 0) {
      const c = queue.shift()!;
      const r = await fetchText(c.url, "discovered page");
      if (r.ok && r.status < 400) {
        if (pages.some((p) => p.url === r.finalUrl)) continue; // redirect onto an existing page
        pages.push({ url: r.finalUrl, html: r.html });
        pagesFetched.push({ url: r.finalUrl, status: r.status });
        for (const link of pageLinks(r.html, r.finalUrl)) enqueue(link.href);
      } else if (r.ok) {
        notes.push(`discovered page responded with HTTP ${r.status} (treated as not found)`);
      } else {
        notes.push(r.error);
      }
      progress(3, Math.min(1, pages.length / maxPages), `Fetching discovered pages (${pages.length}/${maxPages})`);
    }
  }

  progress(deep ? 4 : 3, 0.1, "Extracting claims");
  // ---- analyze pages ----
  const checks: CheckResult[] = [];
  const findings: Finding[] = [];
  const unknowns: { claim: string; reason: string }[] = [];
  const claims: ClaimSpot[] = [];

  const homepageUrl = home.url;

  // 1. HTTPS + redirects
  const enteredHttps = targetUrl.startsWith("https://");
  const finalHttps = homepageUrl.startsWith("https://");
  if (enteredHttps && finalHttps) {
    checks.push({ label: "HTTPS", status: "Pass", detail: "Both the entered and final URLs are https." });
    findings.push(
      makeFinding(
        "Serves over HTTPS",
        "Pass",
        "The URL you entered is https and the final URL after redirects is https.",
        [{ label: "Final URL", url: homepageUrl }],
        "High",
        "domain"
      )
    );
  } else if (enteredHttps && !finalHttps) {
    checks.push({ label: "HTTPS", status: "Fail", detail: `Entered https but final URL is ${homepageUrl}.` });
    findings.push(
      makeFinding(
        "Keeps HTTPS after redirects",
        "Fail",
        `The site redirected ${targetUrl} → ${homepageUrl}, which is not https. That directly contradicts the https URL you entered.`,
        [
          { label: "Entered URL", url: targetUrl },
          { label: "Final URL", url: homepageUrl },
        ],
        "High",
        "domain"
      )
    );
  } else if (!enteredHttps) {
    checks.push({ label: "HTTPS", status: "Unknown", detail: "URL entered as http; no https claim was made." });
    findings.push(
      makeFinding(
        "Serves over HTTPS",
        "Unknown",
        "You entered an http URL, so no https claim was made. Re-scan with the https:// URL to test this.",
        [{ label: "Entered URL", url: targetUrl }],
        "Low",
        "domain"
      )
    );
  }

  if (homeResult.redirected) {
    findings.push(
      makeFinding(
        "Uses a stable URL (no unexpected redirect)",
        "Pass",
        `The final URL after redirects is ${homepageUrl}. We recorded it so the report is about the page you actually see.`,
        [{ label: "Final URL", url: homepageUrl }],
        "High",
        "domain"
      )
    );
  }

  // 2. Pricing / Terms / Privacy presence
  const labelOf = (url: string): "Pricing" | "Terms" | "Privacy" | null => {
    const p = new URL(url).pathname.toLowerCase();
    if (/pricing|price|plans?/.test(p)) return "Pricing";
    if (/(terms|tos|conditions)/.test(p)) return "Terms";
    if (/privacy/.test(p)) return "Privacy";
    return null;
  };
  const pageByLabel: Record<string, Page> = {};
  for (const p of pages) {
    const l = labelOf(p.url);
    if (l && !pageByLabel[l]) pageByLabel[l] = p;
  }
  for (const label of ["Pricing", "Terms", "Privacy"] as const) {
    const page = pageByLabel[label];
    if (page) {
      checks.push({ label: `${label} page`, status: "Pass", detail: `Found at ${page.url}` });
      findings.push(
        makeFinding(
          `Provides a ${label} page`,
          "Pass",
          `A ${label} page was found at ${page.url} and fetched successfully.`,
          [{ label: `${label} page`, url: page.url }],
          "High",
          "pages"
        )
      );
    } else {
      const reason = `No ${label} page was found at the common paths (/pricing, /terms, /privacy, ...) or linked from the homepage. This is not a Fail: the page may exist at a different path, behind a login, or referenced only from pages we did not fetch.`;
      checks.push({ label: `${label} page`, status: "Unknown", detail: reason });
      findings.push(makeFinding(`Provides a ${label} page`, "Unknown", reason, [{ label: "Homepage", url: homepageUrl }], "Medium", "pages"));
      unknowns.push({ claim: `Provides a ${label} page`, reason });
    }
  }

  // 3. rule-based claim extraction on every page
  for (const page of pages) {
    const t = tokens(page.html);
    const lt = lightText(page.html);
    const source: SourceRef = { label: shortLabel(page.url), url: page.url };

    // pricing promise phrases
    for (const r of PRICING_PROMISES) {
      const norm = r.phrase.toLowerCase();
      if (t.includes(norm)) {
        const claim = r.claim;
        const idx = literalIndexInTokens(t, norm);
        const evidence = `The exact phrase "${r.phrase}" appears on ${shortLabel(page.url)}. It is the site's own promise; we did not verify how billing actually works.`;
        findings.push(makeFinding(claim, "Unknown", evidence, [source], "Medium", "pricing"));
        unknowns.push({ claim, reason: evidence });
        claims.push({ text: r.phrase, pageUrl: page.url, snippet: snippetAt(t, idx) });
      }
    }

    // price/billing terms on pricing pages
    const isPricingPage = /pricing|price|plans?/.test(page.url.toLowerCase());
    if (isPricingPage) {
      const priceRe = /\$\s?\d+(?:[\d,.]*)\b|\bper\s+(month|year|user)\b|\bbilled\s+(monthly|annually|yearly)\b/g;
      const m = priceRe.exec(lt);
      if (m) {
        const claim = "Pricing page states a concrete price or billing term";
        const evidence = `The pricing page at ${page.url} contains pricing text like "${m[0]}". This matters because it can conflict with "free" promises elsewhere on the site.`;
        findings.push(makeFinding(claim, "Unknown", evidence, [source], "Medium", "pricing"));
        unknowns.push({ claim, reason: evidence });
        claims.push({ text: m[0], pageUrl: page.url, snippet: snippetForPhrases(lt, ["per month", "per year", "billed", "$"]) });
      }
    }

    // metrics
    let metricCount = 0;
    for (const re of METRIC_PATTERNS) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(lt)) !== null && metricCount < 6) {
        metricCount++;
        const phrase = m[0].trim() || "metric";
        const claim = `Metric claim: "${phrase}"`;
        const evidence = `Found on ${shortLabel(page.url)}. It is a self-reported figure; we have not independently verified it against public records.`;
        findings.push(makeFinding(claim, "Unknown", evidence, [source], "Medium", "metrics"));
        unknowns.push({ claim, reason: evidence });
        claims.push({ text: phrase, pageUrl: page.url, snippet: snippetAt(lt, m.index) });
        if (metricCount >= 6) break;
      }
    }

    // testimonials
    if (TESTIMONIAL_PHRASES.some((p) => t.includes(p))) {
      const claim = "Publishes customer testimonials or endorsements";
      const evidence = `Endorsement-style language (e.g. "${TESTIMONIAL_PHRASES.find((p) => t.includes(p))}") appears on ${shortLabel(page.url)}. Listed for transparency; we do not verify the people quoted are real.`;
      findings.push(makeFinding(claim, "Unknown", evidence, [source], "Medium", "testimonials"));
      unknowns.push({ claim, reason: evidence });
      claims.push({ text: "testimonial-style language", pageUrl: page.url, snippet: snippetForPhrases(t, TESTIMONIAL_PHRASES) });
    }

    // press
    if (PRESS_PHRASES.some((p) => t.includes(p))) {
      const matched = PRESS_PHRASES.find((p) => t.includes(p))!;
      const claim = 'Claims press coverage ("as seen in")';
      const evidence = `Press-style language ("${matched}") appears on ${shortLabel(page.url)}. Listed for transparency; we have not verified that a cited publication exists or covered the site.`;
      findings.push(makeFinding(claim, "Unknown", evidence, [source], "Medium", "press"));
      unknowns.push({ claim, reason: evidence });
      claims.push({ text: matched, pageUrl: page.url, snippet: snippetForPhrases(t, PRESS_PHRASES) });
    }

    // guarantees
    for (const g of GUARANTEE_PHRASES) {
      if (t.includes(g)) {
        const claim = `Guarantee claim: "${g}"`;
        const evidence = `Guarantee language ("${g}") appears on ${shortLabel(page.url)}. It is the site's own promise; we did not verify how refunds are handled.`;
        findings.push(makeFinding(claim, "Unknown", evidence, [source], "Medium", "guarantees"));
        unknowns.push({ claim, reason: evidence });
        claims.push({ text: g, pageUrl: page.url, snippet: snippetAt(t, literalIndexInTokens(t, g)) });
      }
    }

    // review-platform mentions — only Pass when name AND a matching domain are both present
    for (const r of REVIEW_SITES) {
      if (!t.includes(r.token)) continue;
      const links = pageLinks(page.html, page.url);
      const domainMatch = links.some((l) => r.domains.some((d) => l.href.toLowerCase().includes(d)));
      const claim = `Mentions ${r.name} reviews`;
      if (domainMatch) {
        const evidence = `The site mentions "${r.name}" and links to ${r.domains[0]}. The text and the destination both clearly match, so this is treated as a verified ${r.name} mention.`;
        findings.push(makeFinding(claim, "Pass", evidence, [source], "Medium", "reviews"));
      } else {
        const reason = `The site mentions "${r.name}" on ${shortLabel(page.url)}, but no link to a ${r.name} domain was found, so we could not confirm the mention refers to actual ${r.name} listings.`;
        findings.push(makeFinding(claim, "Unknown", reason, [source], "Low", "reviews"));
        unknowns.push({ claim, reason });
      }
      break; // one review-platform mention per page keeps the table readable
    }
  }

  // 4. homepage vs pricing contradictions
  progress(deep ? 5 : 4, 0.2, "Cross-checking pages for contradictions");
  const pricingPage = pageByLabel["Pricing"];
  if (pricingPage) {
    const homeT = tokens(home.html);
    const priceT = tokens(pricingPage.html);
    const freePhrases = ["free forever", "100% free", "always free", "completely free", "no credit card"];
    const paidSignals = ["per month", "per year", "billed monthly", "billed annually", "monthly billing", "credit card"];
    const freeOnHome = freePhrases.filter((f) => homeT.includes(f));
    const paidOnPricing = paidSignals.filter((p) => priceT.includes(p));
    const hasPrice = /\$\s?\d+/.test(lightText(pricingPage.html));

    if (freeOnHome.length > 0 && (paidOnPricing.length > 0 || hasPrice)) {
      const claim = `Homepage promises "${freeOnHome[0]}" while the pricing page indicates payment is required`;
      const evidence = `The homepage (${home.url}) contains "${freeOnHome[0]}", and the pricing page (${pricingPage.url}) contains payment-required language${hasPrice ? " and a concrete price" : ""} ("${paidOnPricing[0] || "price listed"}"). This is a direct contradiction on the site's own pages.`;
      findings.push(makeFinding(claim, "Fail", evidence, [
        { label: "Homepage", url: home.url },
        { label: "Pricing page", url: pricingPage.url },
      ], "High", "contradictions"));
      unknowns.push({ claim, reason: evidence });
    } else if (freeOnHome.length > 0) {
      const claim = `Homepage promises "${freeOnHome.join(", ")}"`;
      const evidence = `The homepage says "${freeOnHome[0]}" and the pricing page does not show payment-required language or a price that we detected. We found no direct contradiction, so this is listed as unverified rather than failed.`;
      findings.push(makeFinding(claim, "Unknown", evidence, [
        { label: "Homepage", url: home.url },
        { label: "Pricing page", url: pricingPage.url },
      ], "Medium", "contradictions"));
      unknowns.push({ claim, reason: evidence });
    } else {
      findings.push(
        makeFinding(
          "Homepage and pricing page show no detected contradiction",
          "Pass",
          `We compared the homepage (${home.url}) with the pricing page (${pricingPage.url}) for a fixed list of phrases (${[
            ...freePhrases,
            ...paidSignals,
          ].join(", ")}) and found no direct contradiction. This is a limited exact-phrase check, not a full audit.`,
          [
            { label: "Homepage", url: home.url },
            { label: "Pricing page", url: pricingPage.url },
          ],
          "Low",
          "contradictions"
        )
      );
    }
  }

  // 5. third-party scripts
  const scriptHosts = new Set<string>();
  for (const page of pages) {
    const re = /<script\b[^>]*\bsrc=["']([^"']+)["']/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(page.html)) !== null) {
      try {
        const u = new URL(m[1], page.url);
        if (u.hostname.toLowerCase().replace(/^www\./, "") !== new URL(page.url).hostname.toLowerCase().replace(/^www\./, "")) {
          scriptHosts.add(u.hostname.toLowerCase().replace(/^www\./, ""));
        }
      } catch {
        // skip
      }
    }
  }
  const knownScripts: string[] = [];
  const otherScripts: string[] = [];
  for (const host of scriptHosts) {
    const match = SCRIPT_HOST_MAP.find(([pat]) => host.includes(pat));
    if (match) knownScripts.push(`${match[1]} (${host})`);
    else otherScripts.push(host);
  }
  if (scriptHosts.size > 0) {
    const claim = `Loads ${scriptHosts.size} third-party script${scriptHosts.size === 1 ? "" : "s"} (${knownScripts.length} known, ${otherScripts.length} unclassified)`;
    const evidence = `Script hosts: ${[...knownScripts, ...otherScripts.map((h) => `${h} (unclassified)`)]
      .join("; ") || "none listed"}. Shown for transparency; listing a script is not a judgment about what it does.`;
    findings.push(makeFinding(claim, "Unknown", evidence, [{ label: "Homepage", url: homepageUrl }], "High", "third-party scripts"));
    unknowns.push({ claim, reason: evidence });
  } else {
    findings.push(
      makeFinding(
        "Loads no third-party scripts from script tags",
        "Pass",
        `No <script src> pointing to another host was found on the pages we fetched (${pages.map((p) => shortLabel(p.url)).join(", ")}). Some sites inline all their scripts, so this check is limited.`,
        [{ label: "Homepage", url: homepageUrl }],
        "Medium",
        "third-party scripts"
      )
    );
  }

  progress(deep ? 6 : 5, 0.4, "Compiling report");
  const uniqueNotes = [...new Set(notes)];
  const scope = `Fetched ${pages.length} page(s): ${pages.map((p) => p.url).join(", ")}. Legal/pricing pages were located via common paths and homepage links.${deep ? " This was a deep lookup: up to ~15 pages were fetched (legal/pricing/about/FAQ paths plus links discovered on pages)." : ""}${uniqueNotes.length ? ` Fetch notes: ${uniqueNotes.slice(0, 10).join("; ")}.` : ""}`;

  const report: Report = {
    id,
    targetUrl: targetUrl.replace(/\/+$/, ""),
    finalUrl: homepageUrl,
    scannedAt: startedAt,
    methodVersion,
    deep,
    scope,
    scanError: uniqueNotes.length ? `Report complete but with notes: ${uniqueNotes.slice(0, 8).join("; ")}` : null,
    checks,
    findings,
    pagesFetched,
    unknowns: unknowns.slice(0, 40),
    snapshotRefs: pages.map((p) => ({ pageUrl: p.url, storedAt: startedAt })),
  };

  return {
    report,
    claims: dedupe(claims, (c) => `${c.pageUrl}|${c.text}`).slice(0, 200),
    snapshot: Object.fromEntries(pages.map((p) => [p.url, { html: p.html, fetchedAt: startedAt }])),
  };
}

function buildErrorReport(id: string, rawUrl: string, at: string, error: string, methodVersion = METHOD_VERSION): Report {
  return {
    id,
    targetUrl: rawUrl.slice(0, 300),
    finalUrl: null,
    scannedAt: at,
    methodVersion,
    scope: `Scan stopped before a full fetch. ${error}`,
    scanError: error,
    checks: [{ label: "Fetch", status: "Unknown", detail: error }],
    findings: [
      makeFinding(
        "Could not scan the URL",
        "Unknown",
        `${error} No findings were invented for an unreachable site. Re-scan later, or check that the URL is correct.`,
        [{ label: "Entered URL", url: rawUrl }],
        "Low",
        "domain"
      ),
    ],
    pagesFetched: [],
    unknowns: [{ claim: "Fetch the target page", reason: error }],
    snapshotRefs: [],
  };
}

function shortLabel(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname === "/" ? "" : u.pathname}`;
  } catch {
    return url;
  }
}

// ---------- public API ----------

export function startScan(rawUrl: string, _opts: ScanOptions = {}): { id: string } {
  const deep = _opts.deep === true;
  const stepsTotal = deep ? 7 : SCAN_STEPS.length; // deep adds "Fetching discovered pages"
  const id = cryptoRandomId(12);
  jobs.set(id, { id, status: "queued", step: SCAN_STEPS[0], progress: 0 });

  void (async () => {
    try {
      const job = jobs.get(id)!;
      const { report, claims, snapshot } = await runScan(id, rawUrl, deep, (index, frac, step) => {
        job.status = "running";
        job.step = step;
        job.progress = Math.min(1, (index + frac) / stepsTotal);
      });
      job.status = "complete";
      job.progress = 1;
      job.step = "Report ready";
      const { storage } = await import("./store");
      // Data-protection guard: never overwrite an existing report. With truly
      // random ids a collision is ~impossible; if one still happens, fail the
      // scan instead of clobbering an existing report.
      if (storage.reportExists(id)) {
        job.status = "error";
        job.step = "Scan failed";
        job.error = "Report id collision — please run the scan again.";
        return;
      }
      await storage.saveReport({ report, claims, snapshot });
    } catch (err) {
      const job = jobs.get(id);
      if (job) {
        job.status = "error";
        job.step = "Scan failed";
        job.error = String(err instanceof Error ? err.message : err);
      }
    }
  })();

  return { id };
}

export function getJob(id: string): ScanProgress | null {
  const j = jobs.get(id);
  if (!j) return null;
  return { id: j.id, status: j.status, step: j.step, progress: j.progress, error: j.error };
}
/**
 * ROBO DEEBO — phishing heuristic scoring engine (deterministic, decision-support).
 *
 * This is the honest foundation of Inbox Patrol: it flags *likely* phishing using
 * published, well-known indicators (see each signal's doc line), and it never
 * claims certainty. Heuristic decision-support only — human judgment is final.
 */

export type RiskBand = "Low" | "Medium" | "High" | "Critical";
export type RecommendedAction = "delete" | "report" | "ignore" | "verify-via-other-channel";

export interface ParsedEmail {
  id: string;
  from: string; // display "Name <addr@domain>"
  fromDomain?: string;
  replyTo?: string;
  subject: string;
  body: string;
  links?: string[];
  attachments?: string[];
  date?: string;
  /** Decoded HTML body before tag-stripping — used by the slice-5 link checker. */
  rawHtml?: string;
  sample?: boolean; // true = demo data, never a real message
}

export interface Signal {
  id: string;
  label: string;
  weight: number;
  evidence: string;
}

export interface ScoreResult {
  score: number; // 0..100 composite
  band: RiskBand;
  signals: Signal[]; // only fired signals
  explanation: string; // Deebo-voice, plain language
  recommendedAction: RecommendedAction;
  certainty: "Low" | "Medium" | "High";
}

/* ------------------------------------------------------------------ */
/* Well-known indicator lists                                          */
/* ------------------------------------------------------------------ */

/** Major brands phishers impersonate. Exact-match here is *not* a signal (see below). */
const BRANDS = [
  "paypal", "amazon", "apple", "icloud", "microsoft", "office365", "outlook",
  "google", "gmail", "netflix", "chase", "bankofamerica", "wellsfargo",
  "citibank", "facebook", "linkedin", "dropbox", "dhl", "fedex", "usps",
  "ups", "irs", "github", "instagram", "whatsapp", "steam", "adobe", "barclays",
];

/** Common TLDs brand domains legitimately use — anything else for a brand word is suspicious. */
const COMMON_TLDS = new Set([
  "com", "net", "org", "io", "co", "app", "dev", "me", "info", "biz", "us",
  "uk", "de", "fr", "ca", "au", "in", "eu", "ai", "cloud", "store", "email",
  "mail", "online", "site", "tech", "social",
]);

/** TLDs heavily abused for phishing/abuse domains (public blacklists, APWG reports). */
const ABUSED_TLDS = new Set([
  "tk", "ml", "ga", "cf", "gq", "xyz", "top", "click", "link", "zip", "mov",
  "work", "loan", "win", "bid", "cam", "rest", "icu", "live", "club", "surf",
  "quest", "gdn", "racing", "monster",
]);

/** URL-shortener / redirector services — hide the real destination from hover previews. */
const REDIRECTORS = [
  "bit.ly", "tinyurl.com", "t.co", "goo.gl", "rebrand.ly", "cutt.ly", "cutt.us",
  "is.gd", "shorturl.at", "rb.gy", "ow.ly", "buff.ly", "tiny.cc", "s.id",
  "su.pr", "shorte.st", "adf.ly", "mcaf.ee", "v.gd", "surl.li",
];

/** Known-good top-level domains for brand impersonation (exact match, no subdomain tricks). */
const EXACT_ALLOW = new Set([
  "paypal.com", "amazon.com", "apple.com", "microsoft.com", "outlook.com",
  "office.com", "google.com", "gmail.com", "netflix.com", "chase.com",
  "bankofamerica.com", "wellsfargo.com", "linkedin.com", "dropbox.com",
  "dhl.com", "fedex.com", "usps.com", "github.com", "instagram.com",
  "whatsapp.com", "steam.com", "adobe.com", "barclays.co.uk", "irs.gov",
]);

/** Attachment extensions that indicate executable/script/active-content risk. */
const RISKY_ATTACHMENTS = [
  "exe", "scr", "bat", "cmd", "com", "pif", "js", "jar", "vbs", "ps1",
  "docm", "xlsm", "iso", "msi", "hta", "lnk",
];
const ARCHIVE_ATTACHMENTS = ["zip", "rar", "7z", "gz"];

/* ------------------------------------------------------------------ */
/* Signal weights (documented rationale per signal)                    */
/* ------------------------------------------------------------------ */
const W = {
  typoDomain: 8, // typo/impersonation domain: attackers register lookalikes (paypa1.com)
  brandTld: 15, // brand word on an abused/unusual TLD (paypal.xyz)
  urlObfuscation: 20, // @-tricks, IP literals, redirectors: hides true destination
  replyToMismatch: 15, // RFC-5322 header mismatch: sender ≠ reply destination
  urgentLanguage: 4, // urgency/threat framing: weaponized pressure (APWG guidance)
  credentialBait: 5, // asks for password/verification/login ("verify your account")
  paymentBait: 5, // invoice/payment/refund framing (BEC-style lures)
  genericGreeting: 5, // "Dear Customer" = mass-sent, not personalized
  attachmentRisk: 15, // executable/script payloads = malware delivery favorites
  archiveRisk: 6, // archives often carry macro/executable payloads
  secrecyPressure: 5, // "confidential/final notice" — manufactured urgency in vishing/BEC
  knownDomain: -8, // exact known-good brand domain lowers suspicion
  noLinksNoAttachments: -4, // nothing to click or open
  personalGreeting: -4, // addressed by name — more plausibly legitimate
} as const;

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

function domainOf(addr: string | undefined): string | undefined {
  if (!addr) return undefined;
  const m = addr.match(/<([^>]+)>/); // display-name form
  const email = (m ? m[1] : addr).trim().toLowerCase();
  const at = email.indexOf("@");
  if (at < 0) return undefined;
  return email.slice(at + 1).replace(/[.)]$/, "");
}

function hostOf(url: string): string | null {
  try {
    const u = new URL(url);
    return u.hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** Tiny Levenshtein for lookalike-domain detection. */
function lev(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return dp[a.length][b.length];
}

function baseOf(host: string): string {
  return host.split(".")[0];
}

function isIpLiteral(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

function isAbusedTld(host: string): boolean {
  const parts = host.split(".");
  return ABUSED_TLDS.has(parts[parts.length - 1]);
}

function isBrandOnOddTld(host: string): boolean {
  const parts = host.split(".");
  const base = baseOf(host);
  const tld = parts[parts.length - 1];
  const brand = BRANDS.find((b) => b.toLowerCase() === base.toLowerCase());
  return !!brand && !COMMON_TLDS.has(tld);
}

function isLookalikeBrand(host: string): { brand: string; score: number } | null {
  const base = baseOf(host).toLowerCase();
  if (!base) return null;
  for (const brand of BRANDS) {
    if (base === brand) return null; // exact = legit-ish, handled elsewhere
    if (lev(brand, base) <= 2) return { brand, score: 1 };
    if (base.includes(brand) && base.length > brand.length + 1)
      return { brand, score: 0.5 }; // e.g. "usps-track", "paypal-secure"
  }
  return null;
}

const URGENT_WORDS = [
  "urgent", "immediately", "within 24 hours", "action required", "suspended",
  "locked", "deactivated", "expired", "final notice", "overdue", "last warning",
  "unauthorized", "verify now", "account will be closed", "will be disabled",
  "act now", "limited time", "at risk", "compromised",
];
const CREDENTIAL_WORDS = [
  "verify your account", "confirm your identity", "confirm your password",
  "sign in to", "login", "update your payment", "reset your password",
  "enter your password", "reactivate your account", "unlock your account",
  "credential", "billing information", "update your details", "security check",
];
const PAYMENT_WORDS = [
  "invoice", "payment", "refund", "transaction", "wire transfer", "gift card",
  "money order", "overpayment", "your order could not", "payment failed",
];
const SECRECY_WORDS = [
  "confidential", "do not share", "keep this quiet", "this is private",
  "only you", "do not tell anyone", "final notice",
];

function includesAny(text: string, words: string[]): string[] {
  const t = text.toLowerCase();
  return words.filter((w) => t.includes(w));
}

/* ------------------------------------------------------------------ */
/* The scorer                                                          */
/* ------------------------------------------------------------------ */

export function scoreEmail(parsed: ParsedEmail): ScoreResult {
  const signals: Signal[] = [];
  const fromDomain = parsed.fromDomain ?? domainOf(parsed.from) ?? "";
  const replyToDomain = domainOf(parsed.replyTo);
  const hay = `${parsed.subject} ${parsed.body}`.toLowerCase();
  const domains: string[] = [];
  const linkHosts: string[] = [];
  for (const link of parsed.links ?? []) {
    const h = hostOf(link);
    if (h) {
      linkHosts.push(h);
      domains.push(h);
    }
  }
  domains.push(fromDomain);

  const add = (id: string, label: string, weight: number, evidence: string) =>
    signals.push({ id, label, weight, evidence });

  // 1) Typo / impersonation domain (published: lookalike-domain abuse in APWG reports)
  const lookalikes: string[] = [];
  for (const h of domains) {
    if (!h) continue;
    const hit = isLookalikeBrand(h);
    if (hit) lookalikes.push(`${h} ≈ ${hit.brand}`);
  }
  if (lookalikes.length) {
    const w = Math.min(W.typoDomain * 2, W.typoDomain * lookalikes.length + W.typoDomain);
    add("typo-domain", "Typo / impersonation domain", w, `${lookalikes.join(", ")} — one letter off or padded with brand lookalike text.`);
  }

  // 2) Brand on abused/unusual TLD
  const oddTlds = domains.filter((d) => d && (isAbusedTld(d) || isBrandOnOddTld(d)));
  if (oddTlds.length) {
    add("brand-tld", "Brand word on an abused/unusual TLD", W.brandTld, `${oddTlds.join(", ")} uses a TLD that's a known phishing favorite or unusual for the brand.`);
  } else if (linkHosts.some(isAbusedTld)) {
    add("brand-tld", "High-risk TLD in links", W.brandTld, "A linked domain uses a TLD from abused-TLD blacklists.");
  }

  // 3) URL obfuscation / redirects
  const obfuscations: string[] = [];
  for (const link of parsed.links ?? []) {
    if (link.includes("@") && /^\w+:\/\/[^@]+@/.test(link)) {
      const after = link.split("@").pop() ?? "";
      obfuscations.push(`@-trick → real host after '@' is ${hostOf("http://" + after) ?? after}`);
    } else {
      const h = hostOf(link);
      if (!h) continue;
      if (isIpLiteral(h)) obfuscations.push(`IP-literal host instead of a name: ${h}`);
      if (link.startsWith("http://")) obfuscations.push(`plain-http link (unencrypted): ${link.slice(0, 48)}…`);
      if (REDIRECTORS.includes(h)) obfuscations.push(`redirector hides the destination: ${h}`);
      if (/%(2f|25|3a|40)/i.test(link)) obfuscations.push(`percent-encoded characters in the link`);
    }
  }
  if (obfuscations.length) {
    const w = Math.min(W.urlObfuscation, W.urlObfuscation / 2 + Math.round(W.urlObfuscation / 3) * obfuscations.length);
    add("url-obfuscation", "URL obfuscation / redirect", w, obfuscations.join("; "));
  }

  // 4) Reply-To mismatch (header-level tell: sender display ≠ where replies go)
  if (replyToDomain && fromDomain && replyToDomain !== fromDomain) {
    add("reply-to-mismatch", "Mismatched Reply-To", W.replyToMismatch, `From is ${fromDomain} but replies would go to ${replyToDomain}.`);
  }

  // 5) Urgent / threat language
  const urgent = includesAny(hay, URGENT_WORDS);
  if (urgent.length) {
    const w = Math.min(12, W.urgentLanguage * urgent.length);
    add("urgent-language", "Urgency / threat framing", w, `Found: ${urgent.slice(0, 4).join(", ")}.`);
  }

  // 6) Credential bait
  const creds = includesAny(hay, CREDENTIAL_WORDS);
  if (creds.length) {
    const w = Math.min(15, W.credentialBait * creds.length);
    add("credential-bait", "Credential bait", w, `Found: ${creds.slice(0, 4).join(", ")}.`);
  }

  // 7) Payment bait
  const pays = includesAny(hay, PAYMENT_WORDS);
  if (pays.length) {
    const w = Math.min(10, W.paymentBait * pays.length);
    add("payment-bait", "Payment / invoice bait", w, `Found: ${pays.slice(0, 3).join(", ")}.`);
  }

  // 8) Generic greeting (mass-mail tell)
  if (/dear\s+(customer|user|member|sir|madam|valued\s+customer|account\s+holder)/i.test(hay)) {
    add("generic-greeting", "Generic greeting", W.genericGreeting, '"Dear Customer/User" — mass-sent, not addressed to you.');
  }

  // 9) Attachment risk
  const risky = (parsed.attachments ?? []).filter((a) => RISKY_ATTACHMENTS.includes(a.split(".").pop()?.toLowerCase() ?? ""));
  const archives = (parsed.attachments ?? []).filter((a) => ARCHIVE_ATTACHMENTS.includes(a.split(".").pop()?.toLowerCase() ?? ""));
  let attachEv = "";
  if (risky.length) {
    attachEv += `executable/script payloads: ${risky.join(", ")}. `;
    add("attachment-risk", "Risky attachment", W.attachmentRisk, `Executable/script attachments are a favorite malware delivery: ${risky.join(", ")}.`);
  }
  if (archives.length) {
    attachEv += `archives (may carry payloads): ${archives.join(", ")}.`;
    add("attachment-risk", "Archive attachment", W.archiveRisk, `Archive attachment that can hide a payload: ${archives.join(", ")}.`);
  }

  // 10) Secrecy / pressure wording
  const secrets = includesAny(hay, SECRECY_WORDS);
  if (secrets.length) {
    add("secrecy-pressure", "Secrecy / pressure wording", W.secrecyPressure, `Found: ${secrets.slice(0, 3).join(", ")}.`);
  }

  /* ---- negative (exculpatory) signals ---- */
  if (fromDomain && EXACT_ALLOW.has(fromDomain)) {
    add("known-domain", "Known-good brand domain", W.knownDomain, `${fromDomain} is an exact known-good brand domain.`);
  }
  if (!(parsed.links ?? []).length && !(parsed.attachments ?? []).length) {
    add("no-links", "No links or attachments", W.noLinksNoAttachments, "Nothing to click and nothing to open.");
  }
  if (/dear\s+([a-z]+)\b/i.test(hay) && !/dear\s+(customer|user|member|sir|madam|valued)/i.test(hay)) {
    add("personal-greeting", "Personal greeting", W.personalGreeting, "Addressed by name — more plausibly legitimate.");
  }

  const raw = signals.reduce((s, sig) => s + (sig.weight > 0 ? sig.weight : 0), 0);
  const neg = signals.reduce((s, sig) => s + (sig.weight < 0 ? sig.weight : 0), 0);
  const score = Math.max(0, Math.min(100, Math.round(raw + neg)));

  const band: RiskBand = score >= 70 ? "Critical" : score >= 45 ? "High" : score >= 20 ? "Medium" : "Low";
  const fired = signals.filter((s) => s.weight > 0);
  const certainty: "Low" | "Medium" | "High" =
    fired.length >= 4 ? "High" : fired.length >= 2 ? "Medium" : "Low";

  const recommendedAction: RecommendedAction =
    band === "Critical" || band === "High" ? "delete" : band === "Medium" ? "verify-via-other-channel" : "ignore";

  const explanation = explain(parsed, band, fired, recommendedAction);

  return { score, band, signals, explanation, recommendedAction, certainty };
}

function explain(parsed: ParsedEmail, band: RiskBand, fired: Signal[], action: RecommendedAction): string {
  const leads = fired.slice(0, 3).map((s) => s.label.toLowerCase());
  const lead = leads.length ? leads.join(", ") : "nothing obviously wrong";
  const voice = {
    Critical: "This one's trying to rob you in broad daylight.",
    High: "This smells like a setup — real bad vibes.",
    Medium: "Something's off here, but it's not a slam dunk.",
    Low: "This one looks clean. Still — trust your gut.",
  }[band];
  const act = {
    delete: "I'd delete it and report it to your provider.",
    "verify-via-other-channel": "Don't use any link in it — verify through another channel first.",
    ignore: "You can let it be; no action needed.",
    report: "Worth a report to the provider.",
  }[action];
  return `${voice} ${lead ? `Tells: ${lead}.` : ""} ${act} Heuristic decision-support — flags likely phishing, never claims certainty.`;
}

/* ------------------------------------------------------------------ */
/* ELITE assessment — same evidence, ROBO DEEBO ELITE format           */
/* ------------------------------------------------------------------ */

export function eliteAssessment(parsed: ParsedEmail): string {
  const r = scoreEmail(parsed);
  const fired = r.signals.filter((s) => s.weight > 0);
  const summary =
    r.band === "Low"
      ? `No significant phishing indicators in "${parsed.subject}". Looks routine — keep an eye glued on it anyway.`
      : `Likely ${r.band.toLowerCase()}-risk message: ${parsed.subject}. Composite score ${r.score}/100 — ${r.band} band.`;
  const facts = fired.length
    ? fired.map((s) => `• ${s.label} (${s.weight > 0 ? "+" : ""}${s.weight}): ${s.evidence}`).join("\n")
    : "• No phishing-type indicators fired.";
  const risks =
    r.band === "Low"
      ? "• Low: none observed beyond ordinary spam noise."
      : r.band === "Medium"
        ? "• Medium: credential or payment bait — acting on it could expose an account or card."
        : "• Critical/High: credential theft, malware delivery, or account takeover if you engage.";
  const recs = {
    delete: "1. Don't click, don't reply, don't download — delete it. 2. Report it to your provider as phishing. 3. If you already clicked, rotate that password and enable MFA now.",
    "verify-via-other-channel": "1. Don't use any link or attachment in this email. 2. Contact the sender through their official site/app or phone number. 3. If it checked out as legit, reply from the real channel.",
    ignore: "1. No action required. 2. If it has links you're unsure about, hover before clicking — always.",
    report: "1. Forward it to your provider's abuse desk. 2. Mark it junk so future ones land in spam.",
  }[r.recommendedAction];
  return `# EXECUTIVE SUMMARY
${summary}
# FACTS
${facts}
# ANALYSIS
• Composite heuristic score ${r.score}/100 lands in the ${r.band} band (${fired.length} signal${fired.length === 1 ? "" : "s"} fired).
• The weightiest tells: ${fired.length ? fired.slice(0, 2).map((s) => s.label.toLowerCase()).join(" and ") : "none"}.
• Heuristic decision-support only — it flags likely phishing, never claims certainty.
# RISKS
${risks}
# RECOMMENDATIONS
${recs}
# CONFIDENCE
${r.certainty}
# ASSUMPTIONS
• Scored from the parsed message fields provided (sender, headers, subject, body, links, attachments) — not a live mailbox scan.`;
}

export function bandColor(band: RiskBand): string {
  return band === "Critical"
    ? "#ff3b30"
    : band === "High"
      ? "var(--color-blaze)"
      : band === "Medium"
        ? "var(--color-signal)"
        : "#7ee787";
}

/* ------------------------------------------------------------------ */
/* SAMPLE EMAILS — clearly labeled demo data, scored by the engine     */
/* ------------------------------------------------------------------ */

export const SAMPLE_EMAILS: ParsedEmail[] = [
  {
    id: "sample-1",
    from: "PayPal Security <security@paypa1.com>",
    fromDomain: "paypa1.com",
    replyTo: "verify@paypa1-updates.tk",
    subject: "URGENT: Your PayPal account has been suspended",
    body: "Dear Customer,\nWe noticed unusual activity. Your account has been suspended and will be closed unless you confirm your password within 24 hours.\nVerify now: http://paypa1.com/secure/confirm",
    links: ["http://paypa1.com/secure/confirm"],
    attachments: [],
    date: "Today, 9:41 AM",
    sample: true,
  },
  {
    id: "sample-2",
    from: "USPS Delivery <tracking@usps-track.top>",
    fromDomain: "usps-track.top",
    subject: "Your package is being held — action required",
    body: "Dear Customer,\nYour package could not be delivered due to an incomplete address. Reschedule delivery within 24 hours or it will be returned.\nhttps://cutt.ly/px9Q2m",
    links: ["https://cutt.ly/px9Q2m"],
    attachments: ["shipment-label.zip"],
    date: "Today, 7:15 AM",
    sample: true,
  },
  {
    id: "sample-3",
    from: "GitHub <noreply@github.com>",
    fromDomain: "github.com",
    replyTo: "noreply@github.com",
    subject: "Your weekly GitHub digest",
    body: "Hi Deebo, here's what the repos you watch shipped this week. No action needed.",
    links: [],
    attachments: [],
    date: "Yesterday",
    sample: true,
  },
];
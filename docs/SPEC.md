# Integrity by 3Two Studios — v1 Build Spec

Derived from the owner's kickoff message. The business plan is the authoritative
strategy doc; this file is the build brief for v1. Owner's rules are non-negotiable.

## Product
A website claim auditor. User pastes a URL → system scans it → public report at
`/r/[id]` listing every claim found and whether public evidence supports,
contradicts, or cannot verify it. **The findings table IS the product.**

## Hard rules (violating any of these is a failed build)
1. The first full report is always free and fully visible. Never hide findings
   behind a paywall, locked "engines," or "unlock for full truth."
2. No dramatic "Integrity Alert / Potential Discrepancies Found" headline that
   withholds the actual list.
3. No single 0–100 "integrity score" as the main result.
4. Every finding shows: Claim | Status (Pass / Fail / Unknown) | Evidence |
   Source link | Confidence.
5. Any status not strongly evidenced by a real source is **Unknown, never Fail**.
6. Limitations stated on every report: not a legal verdict, not a scam
   guarantee, only checks public sources.
7. Show `method_version` on every report.

## Banned
"Fact-Checker" / "Forensics" as module names. Fake social proof, fake counters
("12.4k scans today"), stock testimonials. Copy: never "full Truth," "we expose
fakes," "guaranteed integrity."

## Core promise copy
"We list website claims and the public evidence for or against them."

## User flow
1. Home: one clear input — "Paste a URL". Optional toggle: Single vs Bulk
   (Bulk shows as paid, not built in v1 — display only, no fake buttons).
2. Scan runs with REAL progress (poll a scan-status endpoint; no fake 50% then lock).
3. Results at `/r/[id]` (shareable): target URL + scan timestamp, findings table
   (all visible), passed checks, unknowns (what could not be verified), short
   methodology note + method_version.

## Scanner checks (v1 — public sources only)
- Domain basics: HTTPS, final URL after redirects.
- Presence of Pricing / Privacy / Terms pages (check common paths).
- Extracted claims (deterministic heuristics in v1, no LLM): pricing promises
  ("no credit card", "free forever"), metrics ("10,000 users", "99.9% uptime"),
  testimonials, "as seen in" / press logos, guarantees ("money-back", "lifetime").
- Simple contradictions between homepage text and /pricing or /terms text.
- Third-party script hosts (analytics, ads, session replay) listed for transparency.
- Review-platform mentions only when domain/name clearly matches; else Unknown.

Status rubric: Pass only with deterministic positive evidence (e.g. HTTPS valid);
Fail only on a direct observed contradiction (e.g. homepage says "free forever,"
pricing page shows a required paid plan); everything else Unknown with a reason.

## Tech notes
- Real fetch of the target page + linked legal pages (server-side, with timeout,
  size cap, and safe error handling — unreachable sites produce a clear "could
  not scan" report, never invented findings).
- Store raw snapshot (HTML) + structured claims + report JSON.
- Rule-based extraction in v1; LLM may assist extraction later but must NEVER
  decide Pass/Fail by itself.
- Storage behind a small interface; works without DATABASE_URL in the sandbox
  (file-based under /home/team/shared/data); use the built-in `~/db` sql helper
  path when DATABASE_URL is present.
- Free limit (owner decision 2026-09-06): **1 full free report per user** (visitor
  identity = cookie + IP, soft limit, stated honestly in UI). Viewing an already
  created report is always free and fully visible. After the free report is used,
  new scans get an honest notice: "You've used your 1 free report. Paid plans are
  coming soon." — never a paywall teaser, never blocked access to existing reports.

## Pages
- Home (input + one-sentence promise + what we check / what we don't)
- Report `/r/[id]` — the product
- Methodology (how claims are extracted, how status is decided, confidence meaning)
- Pricing (clear, no dark patterns; Free 3/day; $10 PDF/deep-lookup credit and
  $19/mo watchlist shown as upcoming, honestly labeled — no fake checkout)
- Self-audit: a live report of integrity by 3Two Studios itself (scan the site's
  own URL and link the resulting /r/[id])

## Design
Dark, minimal, high-contrast, serious (not playful SaaS). Monochrome + one
restrained accent (gold/purple only if it fits; otherwise one accent). Mobile-first.

## Out of scope for v1
Bulk scanning, watchlist/email, PDF, real payments, deepfake detection,
supply-chain verification, agent swarms, locked engines.

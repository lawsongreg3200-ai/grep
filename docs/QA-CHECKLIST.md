# Live walkthrough + rules audit — Integrity by 3Two Studios

Script for the owner walkthrough once the core build lands, and the seed for the
formal end-to-end QA pass. Verify everything against the PUBLISHED site
(the ctonew.app URL), never localhost.

## A. End-to-end walkthrough (one real site, chosen for claim-rich copy)
1. Home: one input ("Paste a URL"), promise line, What we check / what we don't,
   Single vs Bulk toggle (Bulk honestly labeled "Paid — coming soon", not clickable).
2. Start a scan of a real, claim-rich site (e.g. a SaaS marketing homepage with
   "no credit card" / "99.9% uptime" style copy). Screenshot each stage.
3. Progress: confirm it is REAL (polls /api/scan/$id/status — network tab or status
   field changes with actual scan stages). No fake 50% → lock.
4. Report /r/[id]: confirm shareable URL, target URL + scan timestamp shown.
5. Findings table: confirm EVERY row shows
   Claim | Status (Pass/Fail/Unknown) | Evidence | Source link | Confidence.
6. Passed checks, unknowns, methodology note + method_version, limitations line.
7. Repeat with an unreachable/bogus domain → must produce an honest
   "could not scan" report, never invented findings.
8. Rate limit: 4th scan attempt same day → honest message, no paywall teaser.

## B. Hard-rules audit (each must PASS on the live site)
R1 First report free + fully visible (no lock, no blur, no paywall anywhere).
R2 No withheld "Integrity Alert / Potential Discrepancies Found" style headline.
R3 No 0–100 integrity score anywhere as a result.
R4 Every finding row has all 5 columns.
R5 Weak evidence ⇒ Unknown, never Fail (spot-check Fail rows: each must cite a
   direct observed contradiction with source).
R6 Limitations statement present on every report ("not a legal verdict, not a
   scam guarantee, only checks public sources").
R7 method_version shown on every report.
R8 Banned copy absent: "full Truth", "we expose", "guaranteed integrity",
   "forced to tell the truth", "verdict", "Fact-Checker", "Forensics",
   "Integrity Alert", "Unlock".
R9 No fake social proof / counters / testimonials; no invented data.

## C. Also grab for the owner
- The live report URL for a real scan (shareable /r/[id]).
- Self-audit report link if pages shipped in this slice.
- Any rule the build breaks → logged plainly, fix delegated before anything else.

## D. PayPal verification (lead runs personally before reporting done)
1. Pricing page: PayPal buttons render, TEST MODE banner visible, Free tier unchanged.
2. $10 flow END-TO-END in sandbox: create order → approve → capture → confirm
   stored order JSON under /home/team/shared/data/orders/ (id, amount, status=COMPLETED).
3. $19/mo subscription: plan exists in sandbox, subscription record stored.
4. Failure paths: bogus input → honest 400; capture failure → honest error, no fake success.
5. TEST_MODE guardrail: no reachable path charges real money; sandbox API base confirmed in code.
6. Site health after changes: all pages 200 (/, /pricing, /privacy, /terms, /methodology,
   /self-audit, a sample /r/[id]); publish succeeded; free 1-report limit unaffected.
7. Only after ALL of the above pass → report to owner. Payouts note: money OUT to the owner's
   bank is configured in their PayPal dashboard, not in our code; our side verifies captures land.

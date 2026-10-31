/**
 * Fixture runner for the ported phishing scorer — NO DEPLOYMENT NEEDED.
 *
 *   cd /home/team/shared/site && bun run convex/scripts/score_fixtures.ts
 *
 * Imports `convex/lib/phishing.ts` directly (the same module `runWatchPass`
 * calls) and scores four fixtures:
 *   1. an obvious phishing email   → must land "phish"
 *   2. a benign newsletter         → must land "safe"
 *   3. a borderline dunning email  → must land "suspect" (not a slam dunk)
 *   4. an empty message            → must be "unscored", never "safe"
 *
 * Prints verdict + score + every signal that fired, then exits non-zero if any
 * fixture lands outside its expected verdict — so this doubles as a check that
 * the port still behaves like the source.
 *
 * This file lives under `convex/` but exports no Convex functions and is never
 * imported by one: it is a dev tool, not part of the deployment surface. It
 * uses only plain console output (no Node built-ins) so it cannot break the
 * bundle.
 */
import {
  hasScorableContent,
  reasonsFor,
  scoreEmail,
  verdictForBand,
  type ParsedEmail,
  type Verdict,
} from "../lib/phishing";

interface Fixture {
  name: string;
  expect: Verdict;
  email: ParsedEmail;
}

const FIXTURES: Fixture[] = [
  {
    name: "obvious phishing — spoofed PayPal, urgency, credential-harvesting link",
    expect: "phish",
    email: {
      id: "fixture-phish-1",
      from: "PayPal Security <security@paypa1.com>",
      fromDomain: "paypa1.com",
      replyTo: "verify@paypa1-updates.tk",
      subject: "URGENT: Your PayPal account has been suspended",
      body:
        "Dear Customer,\nWe noticed unusual activity. Your account has been suspended and will be closed " +
        "unless you confirm your password within 24 hours.\nVerify now: http://paypa1.com/secure/confirm",
      links: ["http://paypa1.com/secure/confirm"],
      attachments: [],
    },
  },
  {
    name: "benign newsletter — real domain, personal greeting, no pressure",
    expect: "safe",
    email: {
      id: "fixture-benign-1",
      from: "The Verge <newsletter@theverge.com>",
      fromDomain: "theverge.com",
      subject: "This week in tech: what shipped, what broke",
      body:
        "Hi Rob,\nHere's your weekly roundup of the stories worth your time. Read online any time — " +
        "no action needed, and you can unsubscribe whenever you like.",
      links: ["https://www.theverge.com/roundup/2026-week-43"],
      attachments: [],
    },
  },
  {
    name: "borderline — plausible vendor dunning mail with pressure + generic greeting",
    expect: "suspect",
    email: {
      id: "fixture-borderline-1",
      from: "Acme Billing <billing@acme-invoicing.com>",
      fromDomain: "acme-invoicing.com",
      subject: "Invoice overdue — final notice",
      body:
        "Dear Customer,\nOur records show payment for invoice #4471 is overdue. Please update your details " +
        "to avoid service interruption.",
      links: ["https://acme-invoicing.com/invoices/4471"],
      attachments: [],
    },
  },
  {
    name: "empty message — nothing to look at, so NOT an all-clear",
    expect: "unscored",
    email: {
      id: "fixture-empty-1",
      from: "someone@example.com",
      fromDomain: "example.com",
      subject: "",
      body: "",
      links: [],
      attachments: [],
    },
  },
];

let failures = 0;

for (const fixture of FIXTURES) {
  console.log("─".repeat(78));
  console.log(`FIXTURE: ${fixture.name}`);
  console.log(`  from:    ${fixture.email.from}`);
  console.log(`  subject: ${fixture.email.subject || "(none)"}`);
  console.log(`  links:   ${(fixture.email.links ?? []).join(", ") || "(none)"}`);

  if (!hasScorableContent(fixture.email)) {
    // The same branch `runWatchPass` takes: no content ⇒ "unscored", not "safe".
    const ok = fixture.expect === "unscored";
    if (!ok) failures++;
    console.log(`  VERDICT: unscored   score: n/a`);
    console.log(`  signals: (none — nothing was scored)`);
    console.log(`  expected ${fixture.expect} → ${ok ? "PASS" : "FAIL"}`);
    continue;
  }

  const result = scoreEmail(fixture.email);
  const verdict = verdictForBand(result.band);
  const fired = result.signals.filter((s) => s.weight > 0);
  const negative = result.signals.filter((s) => s.weight < 0);
  const ok = verdict === fixture.expect;
  if (!ok) failures++;

  console.log(`  VERDICT: ${verdict}   band: ${result.band}   score: ${result.score}/100   certainty: ${result.certainty}`);
  console.log(`  action:  ${result.recommendedAction}`);
  console.log(`  signals fired (${fired.length}):`);
  if (fired.length === 0) console.log(`    (none)`);
  for (const s of fired) console.log(`    +${s.weight}  ${s.id} — ${s.label}: ${s.evidence}`);
  if (negative.length) {
    console.log(`  exculpatory (${negative.length}):`);
    for (const s of negative) console.log(`    ${s.weight}  ${s.id} — ${s.label}: ${s.evidence}`);
  }
  console.log(`  what the watcher would store in scans.reasons:`);
  for (const reason of reasonsFor(result)) console.log(`    • ${reason}`);
  console.log(`  expected ${fixture.expect} → ${ok ? "PASS" : "FAIL"}`);
}

console.log("─".repeat(78));
if (failures > 0) {
  console.log(`RESULT: ${failures} fixture(s) landed outside their expected verdict.`);
  throw new Error("fixture expectations not met");
}
console.log(`RESULT: all ${FIXTURES.length} fixtures landed where expected.`);

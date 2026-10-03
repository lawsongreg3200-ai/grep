import { createFileRoute } from "@tanstack/react-router";
import { PageHeading, Shell } from "~/components/SiteShell";
import { METHOD_VERSION, SCAN_STEPS } from "~/lib/meta";

export const Route = createFileRoute("/methodology")({
  component: Methodology,
});

function Methodology() {
  return (
    <Shell>
      <PageHeading kicker="Methodology">How we check, and why.</PageHeading>
      <p className="mt-4 text-xs uppercase tracking-widest text-white/40">
        Current method version: <span className="mono accent-purple">{METHOD_VERSION}</span> — every
        report carries it
      </p>

      <div className="mt-10 space-y-6 text-sm leading-relaxed text-white/50">
        <Section title="What this product is">
          <p>
            We list website claims and the public evidence for or against them. We check HTTPS and
            where a link really lands; whether Pricing, Privacy, and Terms pages exist; claims on the
            page (pricing promises, metrics, testimonials, "as seen in", guarantees); contradictions
            between the homepage and its pricing page; and which third-party scripts the site runs.
            If we can't verify something, we say{" "}
            <span className="accent-green font-semibold text-white/80">Unknown</span> — we never guess.
          </p>
        </Section>

        <Section title="Why we rebuilt">
          <p>
            We rebuilt this product from scratch. Our first version — at 3twostudios.space — did the
            opposite of what we promise. It hid findings behind locked "engines" with names like the
            Fact-Checker and Forensics, teased "Integrity Alerts" without showing the list, and led
            with a 0–100 "Integrity Score" that looked precise but wasn't evidence of anything. We
            found all of this by auditing our own site — the exact dark patterns we now flag on others
            were in our own build. So we removed the paywall, the score, and the teaser headlines, and
            rebuilt around one rule: show the findings, show the evidence, and let you decide.
          </p>
          <p className="mt-3 font-black uppercase tracking-widest text-white/80">What we changed</p>
          <ul className="mt-2 space-y-2">
            <li>— Every finding is fully visible — no locked engines.</li>
            <li>— Unknown instead of scary labels when the evidence is weak.</li>
            <li>— method_version on every report.</li>
            <li>— Limitations stated on every report.</li>
          </ul>
        </Section>

        <Section title="How a scan works">
          <ol className="list-decimal space-y-2 pl-5">
            {SCAN_STEPS.map((s) => (
              <li key={s}>{s}.</li>
            ))}
          </ol>
          <p className="mt-3">
            We fetch the page for real (plus its pricing, terms, and privacy pages) with a timeout and
            a size cap, extract claim sentences with fixed rules — not AI guesses — and check each one
            against what those public pages actually say. Every fetch failure is recorded in the
            report; we never invent a page we could not load, and we never invent a finding for a site
            we could not reach.
          </p>
        </Section>

        <Section title="How status is decided">
          <ul className="space-y-3">
            <li>
              <span className="font-black tracking-tight text-white">Pass</span> — a check we ran
              directly succeeded (e.g. valid HTTPS, a page that exists and was fetched, a phrase found
              on the page).
            </li>
            <li>
              <span className="font-black tracking-tight text-[#ef4444]">Fail</span> — we observed a
              direct contradiction (e.g. the homepage says "free forever" while the pricing page shows
              a required payment, or an https URL redirects to a non-https page).
            </li>
            <li>
              <span className="font-black tracking-tight accent-green">Unknown</span> — everything
              else, always with the reason why (missing page, no link found, phrase not verified, page
              not fetched). Unknown is never Fail.
            </li>
          </ul>
        </Section>

        <Section title="What Confidence means">
          <ul className="space-y-2">
            <li>
              <span className="font-black tracking-tight text-white">High</span> — the evidence is
              found on the site's own linked page.
            </li>
            <li>
              <span className="font-black tracking-tight text-white">Medium</span> — the evidence is
              present but is a claim by the site itself (self-reported figures, promises).
            </li>
            <li>
              <span className="font-black tracking-tight text-white">Lower</span> — inferred or
              partial; we could not fully confirm what the evidence refers to.
            </li>
          </ul>
        </Section>

        <Section title="Versioning">
          <p>
            Every report carries <span className="mono accent-purple">method_version</span> (the
            version shown at the top of this page) plus the date it was scanned. When the extraction
            rules or status rubric change, the version changes, so old reports can be told apart from
            new ones.
          </p>
        </Section>

        <Section title="Limitations">
          <p>
            This is not a legal verdict, not a scam guarantee, and it only checks public sources. We
            do not verify the business behind the site, its legal standing, bank details, or whether
            quotes and testimonials are from real people. A report is a snapshot at one moment in
            time; pages change. A cleaner site can still misbehave off-page, and an ugly page can
            still be honest.
          </p>
        </Section>
      </div>
    </Shell>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="panel bg-white/[0.03] p-6">
      <h2 className="micro-label accent-purple">{title}</h2>
      <div className="mt-3">{children}</div>
    </div>
  );
}
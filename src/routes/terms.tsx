import { createFileRoute } from "@tanstack/react-router";
import { PageHeading, Shell } from "~/components/SiteShell";

export const Route = createFileRoute("/terms")({
  component: Terms,
});

function Terms() {
  return (
    <Shell>
      <PageHeading kicker="Terms">Terms of use.</PageHeading>
      <p className="mt-4 text-xs uppercase tracking-widest text-white/35">
        Last updated: September 16, 2026
      </p>

      <div className="mt-10 max-w-xl space-y-6 text-sm leading-relaxed text-white/50">
        <div className="panel bg-white/[0.03] p-6">
          <h2 className="micro-label accent-purple">What this service does</h2>
          <p className="mt-3">
            Integrity by 3Two Studios lists website claims and the public evidence for or against
            them.
          </p>
        </div>

        <div className="panel bg-white/[0.03] p-6">
          <h2 className="micro-label accent-purple">Sharing reports</h2>
          <p className="mt-3">Report links may be shared freely.</p>
        </div>

        <div className="panel bg-white/[0.03] p-6">
          <h2 className="micro-label accent-purple">Use of this site</h2>
          <p className="mt-3">
            Bulk scraping or redistribution of the report index or site content is not permitted.
          </p>
        </div>

        <div className="panel bg-white/[0.03] p-6">
          <h2 className="micro-label accent-purple">Limitations</h2>
          <p className="mt-3">
            This is not a legal verdict, not a scam guarantee — it only checks public sources. A
            report is a snapshot of public pages at one moment in time; pages change.
          </p>
        </div>

        <div className="panel bg-white/[0.03] p-6">
          <h2 className="micro-label accent-purple">Contact</h2>
          <p className="mt-3">
            Questions or concerns about this page? Contact us — a public contact address will be
            listed here when one is available.
          </p>
        </div>
      </div>
    </Shell>
  );
}
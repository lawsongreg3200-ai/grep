import { createFileRoute } from "@tanstack/react-router";
import { PageHeading, Shell } from "~/components/SiteShell";

export const Route = createFileRoute("/privacy")({
  component: Privacy,
});

function Privacy() {
  return (
    <Shell>
      <PageHeading kicker="Privacy">What we collect, and nothing more.</PageHeading>
      <p className="mt-4 text-xs uppercase tracking-widest text-white/35">
        Last updated: October 1, 2026
      </p>

      <div className="mt-10 max-w-xl space-y-6 text-sm leading-relaxed text-white/50">
        <div className="panel bg-white/[0.03] p-6">
          <h2 className="micro-label accent-purple">What we collect</h2>
          <p className="mt-3">
            One cookie on this site records that you've used your 1 free report. Your IP address is
            used only to keep the free-report limit honest — we store an IP-derived key with a scan
            count, nothing else.
          </p>
        </div>

        <div className="panel bg-white/[0.03] p-6">
          <h2 className="micro-label accent-purple">What we don't do</h2>
          <p className="mt-3">
            No third-party analytics or tracking scripts on our own site. No ads, no profiling, no
            data sale. The free-report limit is the only reason we keep any browser or IP-derived
            state at all.
          </p>
        </div>

        <div className="panel bg-white/[0.03] p-6">
          <h2 className="micro-label accent-purple">Reports are public by design</h2>
          <p className="mt-3">
            Anything scanned produces a shareable page at /r/[id] showing the target URL and the
            claims found on it. That content is about the scanned site, not about you. Don't scan a
            URL if you don't want its claims published in a report.
          </p>
        </div>

        <div className="panel bg-white/[0.03] p-6">
          <h2 className="micro-label accent-purple">Deleting your state</h2>
          <p className="mt-3">
            Clearing your browser cookies for this site resets your free-report cookie. Because the
            limit also counts by IP, clearing cookies alone won't grant extra free reports.
          </p>
        </div>

        <div className="panel bg-white/[0.03] p-6">
          <h2 className="micro-label accent-purple">Data we store per report</h2>
          <p className="mt-3">
            Each scan stores the raw HTML snapshots of the pages we fetched, the extracted claims,
            and the report itself — so the public report can be reproduced. This is stored
            server-side and kept as long as the report exists publicly.
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
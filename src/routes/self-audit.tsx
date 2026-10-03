import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { PageHeading, Shell } from "~/components/SiteShell";
import { METHOD_VERSION } from "~/lib/meta";

export const Route = createFileRoute("/self-audit")({
  component: SelfAudit,
});

const SELF_URL = "https://000f527219985c9c0022508bb115ec7c.ctonew.app";
// Live self-audit report: scanned with the same public scanner every visitor
// uses, method 2026-09-06.2 (see method_version on the report).
const SELF_REPORT_ID = "4jp2qpasl7g9";

function SelfAudit() {
  const [phase, setPhase] = useState<"idle" | "running" | "done" | "error">("idle");
  const [reportUrl, setReportUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [animating, setAnimating] = useState(false);

  async function run() {
    setPhase("running");
    setError(null);
    setReportUrl(null);
    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: SELF_URL }),
      });
      const data = (await res.json()) as { id?: string; error?: string };
      if (!res.ok || !data.id) {
        setPhase("error");
        setError(data.error ?? "Scan could not start.");
        return;
      }
      const id = data.id;
      // Animate a scan (the real scan is normally too fast to watch).
      setAnimating(true);
      await wait(2600);
      setAnimating(false);
      // Resolve to the final report.
      for (let i = 0; i < 30; i++) {
        const status = (await (await fetch(`/api/scan/${id}/status`)).json()) as {
          status: string;
          error?: string;
        };
        if (status.status === "complete") {
          setPhase("done");
          setReportUrl(`/r/${id}`);
          return;
        }
        if (status.status === "error") {
          setPhase("error");
          setError(status.error ?? "Scan failed.");
          return;
        }
        await wait(1000);
      }
      setPhase("error");
      setError("Scan took too long.");
    } catch {
      setPhase("error");
      setError("Could not reach the scanner. Try again shortly.");
    }
  }

  return (
    <Shell>
      <PageHeading kicker="Self-audit">We run our own tool on our own site.</PageHeading>
      <p className="mt-4 max-w-xl text-sm leading-relaxed text-white/55">
        Integrity by 3Two Studios holds itself to the same tool it ships. This page scans the site's
        own URL and links the resulting public report — no special treatment, no internal endpoint.
      </p>
      <p className="mt-2 text-xs uppercase tracking-widest text-white/35">
        Target: <span className="mono text-white/60">{SELF_URL}</span> · method version{" "}
        <span className="mono accent-purple">{METHOD_VERSION}</span>
      </p>

      <div className="mt-10 max-w-xl">
        {phase === "idle" && (
          <>
            <div className="panel bg-white/[0.03] p-6">
              <p className="micro-label accent-green">Our live self-audit report is public</p>
              <a
                href={`/r/${SELF_REPORT_ID}`}
                className="accent-purple mt-3 inline-block text-sm underline underline-offset-4 hover:text-white"
              >
                Open our self-audit report /r/{SELF_REPORT_ID}
              </a>
              <p className="mt-3 text-xs leading-relaxed text-white/40">
                Scanned with the same public scanner every visitor uses — no internal endpoint, no
                special treatment. The report shows method version {METHOD_VERSION} and the same
                limitations any report shows.
              </p>
            </div>
            <div className="mt-6">
              <button onClick={run} className="btn-old">
                Scan our site again
              </button>
              <p className="mt-3 text-xs leading-relaxed text-white/35">
                Re-running creates a fresh report and uses your 1 free report. The link above always
                stays public and free to view.
              </p>
            </div>
          </>
        )}

        {phase === "running" && (
          <div className="panel relative bg-white/[0.03] p-6" aria-live="polite">
            <div className="scanline-track">
              <div className="scanline-bar" />
            </div>
            <p className="micro-label text-white/50">
              {animating ? "SCANNING OUR OWN SITE" : "WAITING FOR THE SCANNER"}
            </p>
            <p className="mt-3 break-all text-xs leading-relaxed text-white/40">{SELF_URL}</p>
          </div>
        )}

        {phase === "done" && reportUrl && (
          <div className="panel bg-white/[0.03] p-6" aria-live="polite">
            <p className="micro-label accent-green">Our own report is live</p>
            <a
              href={reportUrl}
              className="accent-purple mt-3 inline-block text-sm underline underline-offset-4 hover:text-white"
            >
              Open our self-audit report
            </a>
          </div>
        )}

        {phase === "error" && error && (
          <div className="panel border-[#ef4444]/40 bg-white/[0.03] p-6" role="alert">
            <p className="micro-label text-[#ef4444]">Scan not started</p>
            <p className="mt-2 text-sm text-white/70">{error}</p>
          </div>
        )}
      </div>

      <section className="mt-10 max-w-xl space-y-3 border-t border-white/10 pt-6 text-sm leading-relaxed text-white/50">
        <h2 className="micro-label accent-purple">Why we publish this</h2>
        <p>
          The product constitution requires that nothing be hidden. Running the scanner on our own
          site (and keeping the report public) is the simplest way to prove the tool reports on us
          exactly the way it reports on anyone else.
        </p>
        <p>
          Expect the same shape as any other report: Pass where we directly evidence something,
          Unknown where we can't, and always the limitations note — this is not a legal verdict, not a
          scam guarantee, only public sources.
        </p>
      </section>
    </Shell>
  );
}

function wait(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
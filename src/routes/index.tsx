import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "~/components/SiteShell";

export const Route = createFileRoute("/")({
  component: Home,
});

type Phase = "idle" | "scanning" | "done" | "error";

const CHECK_CARDS = [
  {
    name: "Domain Basics",
    desc: "HTTPS, where a link really lands, and a final URL we can name.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-5 w-5">
        <rect x="3" y="4" width="18" height="14" rx="2" />
        <path d="M8 21h8M12 18v3" />
      </svg>
    ),
  },
  {
    name: "Legal Pages",
    desc: "Whether Pricing, Privacy, and Terms pages exist and are reachable.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-5 w-5">
        <path d="M7 3h7l4 4v14H7z" />
        <path d="M14 3v4h4M10 12h5M10 16h5" />
      </svg>
    ),
  },
  {
    name: "Claims & Promises",
    desc: "Pricing promises, metrics, testimonials, “as seen in”, guarantees.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-5 w-5">
        <path d="M9 11l3 3L22 4" />
        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
      </svg>
    ),
  },
  {
    name: "Scripts & Trackers",
    desc: "Which third-party scripts the site runs, listed for transparency.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-5 w-5">
        <path d="M8 4l-6 8 6 8M16 4l6 8-6 8" />
      </svg>
    ),
  },
];

function Home() {
  const [url, setUrl] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [step, setStep] = useState("");
  const [progress, setProgress] = useState(0);
  const [reportUrl, setReportUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function startScan(e: React.FormEvent) {
    e.preventDefault();
    const value = url.trim();
    if (!value) return;
    setPhase("scanning");
    setStep("Starting scan");
    setProgress(0);
    setError(null);
    setReportUrl(null);

    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: value }),
      });
      const data = (await res.json()) as {
        id?: string;
        error?: string;
        message?: string;
      };
      if (!res.ok || !data.id) {
        setPhase("error");
        setError(data.error ?? data.message ?? "Scan could not be started.");
        return;
      }

      // Real progress: poll the status endpoint until complete or error.
      const id = data.id;
      for (let i = 0; i < 240; i++) {
        await sleep(1000);
        const statusRes = await fetch(`/api/scan/${id}/status`);
        const status = (await statusRes.json()) as {
          status: string;
          step: string;
          progress: number;
          error?: string;
        };
        setStep(status.step ?? "Working");
        setProgress(status.progress ?? 0);
        if (status.status === "complete") {
          setPhase("done");
          setReportUrl(`/r/${id}`);
          return;
        }
        if (status.status === "error") {
          setPhase("error");
          setError(status.error ?? "The scan failed; please try again shortly.");
          return;
        }
      }
      setPhase("error");
      setError("The scan took too long. Please try again.");
    } catch {
      setPhase("error");
      setError("The scanner could not be reached. Please try again in a moment.");
    }
  }

  return (
    <Shell>
      {/* HERO — centered, two-line display headline + input front and center */}
      <section className="mx-auto max-w-2xl pt-10 text-center sm:pt-16">
        <p className="micro-label accent-purple">Website claim auditor</p>
        <h1 className="mt-4 text-3xl font-black leading-[1.05] tracking-tighter text-white sm:text-4xl">
          What does this website promise?
          <br />
          And what backs it up?
        </h1>
        <p className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-white/55 sm:text-base">
          We list website claims and the public evidence for or against them.
        </p>

        <form onSubmit={startScan} className="mx-auto mt-8 max-w-lg">
          <label htmlFor="url" className="sr-only">
            Website URL to scan
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              id="url"
              type="text"
              inputMode="url"
              autoComplete="url"
              placeholder="https://example.com"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="w-full flex-1 border border-white/15 bg-white/[0.04] px-4 py-2.5 text-sm text-white placeholder-white/30 outline-none transition-colors focus:border-[#B57BE0]/70"
            />
            <button
              type="submit"
              disabled={phase === "scanning" || !url.trim()}
              className="btn-old disabled:cursor-not-allowed disabled:opacity-40"
            >
              {phase === "scanning" ? "Scanning…" : "Scan site"}
            </button>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-white/35">
            Each visitor gets 1 free full report. After that, paid plans are coming soon — but every
            report already on the site stays public and fully visible. Nothing is ever locked or
            hidden.
          </p>
        </form>

        {/* mode toggle: Bulk honestly labeled paid/coming soon — display only */}
        <div className="mt-6 inline-flex items-center border border-white/10 text-xs uppercase tracking-widest">
          <span className="border-r border-white/10 bg-white/[0.06] px-4 py-2 text-white">
            Single
          </span>
          <span className="px-4 py-2 text-white/40">
            Bulk <span className="ml-1 text-[10px] text-white/30">paid · coming soon</span>
          </span>
        </div>
      </section>

      {/* SCANNING — bordered panel + scanline sweep + cycling real stage labels */}
      {phase === "scanning" && (
        <section className="mx-auto mt-10 max-w-2xl" aria-live="polite">
          <div className="panel relative bg-white/[0.03] p-6">
            <div className="scanline-track">
              <div className="scanline-bar" />
            </div>
            <p className="micro-label text-white/50">
              {step ? step.toUpperCase() : "INITIALIZING"}
            </p>
            <div className="mt-4 h-px w-full bg-white/10">
              <div
                className="h-px bg-[#B57BE0] transition-all duration-500"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
            <p className="mt-3 text-right text-[11px] tracking-widest text-white/40">
              {Math.round(progress * 100)}% · REAL SCAN IN PROGRESS
            </p>
          </div>
        </section>
      )}

      {phase === "done" && reportUrl && (
        <section className="mx-auto mt-10 max-w-2xl" aria-live="polite">
          <div className="panel bg-white/[0.03] p-6">
            <p className="micro-label accent-green">Scan complete</p>
            <p className="mt-2 text-sm text-white/60">The full report is ready — every finding visible.</p>
            <a
              href={reportUrl}
              className="btn-old mt-4"
            >
              Open report /r/{reportUrl.split("/r/")[1]}
            </a>
          </div>
        </section>
      )}

      {phase === "error" && error && (
        <section className="mx-auto mt-10 max-w-2xl" aria-live="polite">
          <div className="panel border-[#ef4444]/40 bg-white/[0.03] p-6">
            <p className="micro-label text-[#ef4444]">Scan not started</p>
            <p className="mt-2 text-sm leading-relaxed text-white/70">{error}</p>
          </div>
        </section>
      )}

      {/* WHAT WE CHECK — 2x2 card grid, old-site style */}
      <section className="mx-auto mt-16 max-w-2xl">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-black uppercase tracking-[0.25em] text-white">What we check</h2>
          <span className="micro-label text-white/35">four passes, all public</span>
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          {CHECK_CARDS.map((c) => (
            <div key={c.name} className="panel bg-white/[0.03] p-5 transition-colors hover:bg-white/[0.05]">
              <div className="flex items-center gap-3">
                <span className="accent-purple">{c.icon}</span>
                <h3 className="text-sm font-black tracking-tight text-white">{c.name}</h3>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-white/50">{c.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Who this is for — owner deck, no stats */}
      <section className="mx-auto mt-16 max-w-2xl">
        <h2 className="text-sm font-black uppercase tracking-[0.25em] text-white">Who this is for</h2>
        <div className="mt-5 space-y-5 text-sm leading-relaxed">
          <div className="border-l border-[#B57BE0]/50 pl-4">
            <h3 className="font-black tracking-tight text-white">Founders</h3>
            <p className="mt-1 text-white/50">
              Audit your own site before a customer, journalist, or investor does. See which of your
              claims lack public evidence — and fix them before they cost you.
            </p>
          </div>
          <div className="border-l border-[#B57BE0]/50 pl-4">
            <h3 className="font-black tracking-tight text-white">Companies</h3>
            <p className="mt-1 text-white/50">
              See what a vendor's website promises, and what public evidence backs it, before you sign.
            </p>
          </div>
          <div className="border-l border-[#B57BE0]/50 pl-4">
            <h3 className="font-black tracking-tight text-white">Everyone</h3>
            <p className="mt-1 text-white/50">
              Check the claims on any site before you hand over money.
            </p>
          </div>
        </div>
      </section>

      {/* What we check / what we don't — owner deck */}
      <section className="mx-auto mt-16 max-w-2xl">
        <div className="grid gap-8 sm:grid-cols-2">
          <div>
            <h2 className="text-sm font-black uppercase tracking-[0.25em] text-white">We check</h2>
            <ul className="mt-4 space-y-3 text-sm leading-relaxed text-white/50">
              <li>HTTPS and where a link really lands</li>
              <li>Whether Pricing, Privacy, and Terms pages exist</li>
              <li>
                Claims on the page — pricing promises, metrics, testimonials, "as seen in", guarantees
              </li>
              <li>Contradictions between the homepage and its pricing page</li>
              <li>Which third-party scripts the site runs</li>
            </ul>
          </div>
          <div>
            <h2 className="text-sm font-black uppercase tracking-[0.25em] text-white">We don't</h2>
            <ul className="mt-4 space-y-3 text-sm leading-relaxed text-white/50">
              <li>Private data, or anything behind a login</li>
              <li>Read intent — a page can look confident and still say little</li>
              <li>Give the site a score, or a good-guy / bad-guy label</li>
              <li>Guarantee what happens after you hand over money</li>
            </ul>
            <p className="mt-5 text-sm leading-relaxed text-white/50">
              If we can't verify something, we say{" "}
              <span className="accent-green font-semibold">Unknown</span> — we never guess.
            </p>
          </div>
        </div>
      </section>

      {/* Why we rebuilt — owner deck */}
      <section className="mx-auto mt-16 max-w-2xl border-t border-white/10 pt-10">
        <h2 className="text-sm font-black uppercase tracking-[0.25em] text-white">Why we rebuilt</h2>
        <p className="mt-4 text-sm leading-relaxed text-white/50">
          We rebuilt this product from scratch. Our first version — at 3twostudios.space — did the
          opposite of what we promise. It hid findings behind locked "engines" with names like the
          Fact-Checker and Forensics, teased "Integrity Alerts" without showing the list, and led
          with a 0–100 "Integrity Score" that looked precise but wasn't evidence of anything. We
          found all of this by auditing our own site — the exact dark patterns we now flag on others
          were in our own build. So we removed the paywall, the score, and the teaser headlines, and
          rebuilt around one rule: show the findings, show the evidence, and let you decide.
        </p>
        <p className="mt-3 text-sm text-white/50">
          The fuller version — including exactly what we changed — is on the{" "}
          <a href="/methodology" className="accent-purple underline underline-offset-4 hover:text-white">
            methodology page
          </a>
          .
        </p>
      </section>
    </Shell>
  );
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
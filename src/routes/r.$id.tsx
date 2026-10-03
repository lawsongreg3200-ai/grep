// Public report page — /r/$id — the product.
// The findings table is always fully visible; nothing is ever hidden or locked.
// Data loads via a server function (executes inline during SSR and over RPC on
// the client), so curl sees the full rendered table in the HTML.
import { useEffect, useState } from "react";
import { createFileRoute, Link, notFound, Outlet, useMatch } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import type { CheckResult, Finding, Report } from "~/lib/types";
import { Shell } from "~/components/SiteShell";

const loadReport = createServerFn({ method: "GET" })
  .validator((id: string) => id)
  .handler(async ({ data: id }) => {
    if (!/^[a-z0-9-]{6,64}$/.test(id)) return null;
    const { storage } = await import("~/lib/store");
    const record = await storage.loadReport(id);
    return record?.report ?? null;
  });

export const Route = createFileRoute("/r/$id")({
  component: ReportPage,
  loader: async ({ params }) => {
    // Server fn call convention: pass the payload as { data: ... } — the
    // compiled SSR shim forwards args to __executeServer(opts), which reads
    // opts.data. A bare positional arg never reaches the validator.
    const report = await loadReport({ data: params.id });
    if (!report) throw notFound();
    return { report };
  },
  notFoundComponent: () => (
    <Shell>
      <p className="py-16 text-sm text-white/50">
        Report not found. It may have been removed, or the id is wrong.
      </p>
    </Shell>
  ),
});

function ReportPage() {
  // /r/$id is a layout route for /r/$id/pdf (and any future child). When a child
  // route matched, render it; otherwise render this page's own view. Both hooks
  // are called unconditionally to keep hook order stable.
  const pdfMatch = useMatch({ from: "/r/$id/pdf", shouldThrow: false });
  const { report } = Route.useLoaderData();
  if (pdfMatch) return <Outlet />;
  return <ReportView report={report} />;
}

function ReportView({ report }: { report: Report }) {
  const passCount = report.findings.filter((f) => f.status === "Pass").length;
  const failCount = report.findings.filter((f) => f.status === "Fail").length;
  const unknownCount = report.findings.filter((f) => f.status === "Unknown").length;
  const isDeep = report.deep === true || report.methodVersion.endsWith("-deep");

  // Deep-lookup credit state + the deep scan flow ($10 tier feature).
  const [credits, setCredits] = useState<number | null>(null);
  const [deepPhase, setDeepPhase] = useState<"idle" | "starting" | "scanning" | "error">("idle");
  const [deepStep, setDeepStep] = useState("");
  const [deepProgress, setDeepProgress] = useState(0);
  const [deepError, setDeepError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/credits")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (alive) setCredits(typeof j?.credits === "number" ? j.credits : null);
      })
      .catch(() => {
        if (alive) setCredits(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  async function runDeep() {
    if (credits === null || credits < 1 || deepPhase !== "idle") return;
    setDeepPhase("starting");
    setDeepError(null);
    try {
      const res = await fetch("/api/deepscan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: report.targetUrl }),
      });
      const data = (await res.json()) as { id?: string; deep?: boolean; credits?: number; error?: string; message?: string };
      if (!res.ok || !data.id) {
        setDeepPhase("error");
        setDeepError(data.error ?? data.message ?? "The deep scan could not be started.");
        setCredits(0);
        return;
      }
      setCredits(typeof data.credits === "number" ? data.credits : 0);
      setDeepPhase("scanning");
      const id = data.id;
      for (let i = 0; i < 300; i++) {
        await sleep(1000);
        const sr = await fetch(`/api/scan/${id}/status`);
        const st = (await sr.json()) as { status: string; step: string; progress: number; error?: string };
        setDeepStep(st.step ?? "Working");
        setDeepProgress(st.progress ?? 0);
        if (st.status === "complete") {
          window.location.href = `/r/${id}`;
          return;
        }
        if (st.status === "error") {
          setDeepPhase("error");
          setDeepError(st.error ?? "The deep scan failed; please try again shortly.");
          return;
        }
      }
      setDeepPhase("error");
      setDeepError("The deep scan took too long. Please try again.");
    } catch {
      setDeepPhase("error");
      setDeepError("The deep scanner could not be reached. Please try again in a moment.");
    }
  }

  return (
    <Shell>
      <div className="rise-in">
        <p className="micro-label accent-purple">Public claim report</p>
        <h1 className="mt-3 break-all text-2xl font-black leading-tight tracking-tighter text-white sm:text-3xl">
          <a
            href={report.targetUrl}
            target="_blank"
            rel="noreferrer"
            className="hover:text-[#B57BE0]"
          >
            {report.targetUrl}
          </a>
        </h1>

        {/* TARGET · SCANNED · METHOD — micro-label header panels */}
        <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <MetaPanel label="Target" value={report.targetUrl} mono />
          <MetaPanel label="Scanned" value={formatDate(report.scannedAt)} />
          <MetaPanel
            label="Method"
            value={`${report.methodVersion} · ${report.id}${isDeep ? " · deep lookup" : ""}`}
            mono
          />
        </div>

        {/* PDF view link + deep lookup — the $10 tier's live features */}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <Link
            to={`/r/${report.id}/pdf`}
            className="inline-flex items-center gap-2 border border-white/15 px-4 py-2.5 text-xs uppercase tracking-[0.2em] text-white transition-colors hover:border-white/40 hover:bg-white/5"
          >
            Print-ready PDF view
          </Link>
          <div className="border border-white/10 bg-white/[0.03] px-4 py-3">
            <p className="micro-label accent-purple">Deep lookup</p>
            <p className="mt-1 max-w-md text-xs leading-relaxed text-white/50">
              Re-scan this URL fetching up to ~15 pages and extract claims from all of them.
              Consumes 1 deep-lookup credit (
              {credits === null ? "balance unavailable" : `${credits} credit${credits === 1 ? "" : "s"} left`}
              ).
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              {deepPhase === "scanning" ? (
                <div className="min-w-[200px] flex-1">
                  <div className="h-px w-full bg-white/10">
                    <div
                      className="h-px bg-[#B57BE0] transition-all duration-500"
                      style={{ width: `${Math.round(deepProgress * 100)}%` }}
                    />
                  </div>
                  <p className="mt-2 text-[11px] tracking-widest text-white/40">{deepStep}</p>
                </div>
              ) : credits !== null && credits > 0 ? (
                <button
                  type="button"
                  onClick={runDeep}
                  disabled={deepPhase === "starting"}
                  className="btn-old disabled:cursor-wait disabled:opacity-60"
                >
                  {deepPhase === "starting" ? "Starting…" : "Run deep lookup"}
                </button>
              ) : (
                <Link to="/pricing" className="btn-old">
                  Get a deep-lookup credit ($10 tier)
                </Link>
              )}
              {deepPhase === "error" && deepError && (
                <span className="text-xs text-red-300">{deepError}</span>
              )}
            </div>
            {credits === 0 && deepPhase === "idle" && (
              <p className="mt-2 text-[11px] leading-relaxed text-white/35">
                You have no deep-lookup credits. The $10 tier (test mode) includes one — no
                recurring charge. Existing reports always stay free and fully visible.
              </p>
            )}
          </div>
        </div>

        {/* Status summary — counts, not a score */}
        <div className="mt-6 grid grid-cols-3 gap-3">
          <Stat label="Pass" value={passCount} tone="text-[#00C853]" />
          <Stat label="Fail" value={failCount} tone="text-[#ef4444]" />
          <Stat label="Unknown" value={unknownCount} tone="text-white/70" />
        </div>

        {report.scanError && (
          <div className="mt-6 border border-[#ef4444]/40 bg-white/[0.03] p-5 text-sm leading-relaxed text-white/70">
            <span className="micro-label text-[#ef4444]">Scan note: </span>
            {(() => {
              // Scanner logs one note per fetch attempt, so identical lines repeat. Collapse for display; order preserved.
              const raw = report.scanError.replace(/^Report complete but with notes:\s*/, "");
              return [...new Set(raw.split(/;\s*/))].join("; ");
            })()}
          </div>
        )}

        {/* The findings table — the product. Every row always visible. */}
        <section className="mt-10">
          <h2 className="text-sm font-black uppercase tracking-[0.25em] text-white">Findings</h2>
          {report.findings.length === 0 ? (
            <p className="mt-4 text-sm leading-relaxed text-white/50">
              No claims were extracted from the pages we fetched. That can happen for minimal or
              script-only pages.
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto border border-white/10 bg-white/[0.02]">
              <table className="w-full min-w-[720px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-[11px] uppercase tracking-[0.25em] text-white/40">
                    <th className="py-3 pl-4 pr-3 font-semibold">Claim</th>
                    <th className="py-3 pr-3 font-semibold">Status</th>
                    <th className="py-3 pr-3 font-semibold">Evidence</th>
                    <th className="py-3 pr-3 font-semibold">Source</th>
                    <th className="py-3 pr-4 font-semibold">Confidence</th>
                  </tr>
                </thead>
                <tbody>
                  {report.findings.map((f) => (
                    <FindingRow key={f.id} finding={f} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Checks that passed / what we looked at */}
        <section className="mt-10">
          <h2 className="text-sm font-black uppercase tracking-[0.25em] text-white">Checks</h2>
          <ul className="mt-4 space-y-2">
            {report.checks.map((c, i) => (
              <li
                key={i}
                className="flex items-start gap-3 text-sm leading-relaxed text-white/50"
              >
                <Span dot={c.status} />
                <span className="min-w-0 flex-1 break-all">
                  <span className="font-semibold text-white/80">{c.label}</span>
                  <span className="text-white/30"> — </span>
                  {c.detail}
                </span>
              </li>
            ))}
          </ul>
        </section>

        {/* Unknowns with reasons */}
        {report.unknowns.length > 0 && (
          <section className="mt-10">
            <h2 className="text-sm font-black uppercase tracking-[0.25em] text-white">
              Could not verify
            </h2>
            <ul className="mt-4 space-y-2 text-sm leading-relaxed text-white/50">
              {report.unknowns.slice(0, 30).map((u, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span className="accent-purple mt-2 h-1 w-1 shrink-0 rounded-full bg-current" />
                  <span className="min-w-0 flex-1 break-all">
                    <span className="font-semibold text-white/80">{u.claim}.</span> {u.reason}
                  </span>
                </li>
              ))}
            </ul>
            {report.unknowns.length > 30 && (
              <p className="mt-2 text-xs text-white/35">
                {"\u2026"}and {report.unknowns.length - 30} more.
              </p>
            )}
          </section>
        )}

        {/* Scope / pages fetched */}
        <section className="mt-10">
          <h2 className="text-sm font-black uppercase tracking-[0.25em] text-white">
            What was scanned
          </h2>
          <p className="mt-4 break-all text-sm leading-relaxed text-white/50">{report.scope}</p>
          <ul className="mt-3 space-y-1">
            {report.pagesFetched.map((p, i) => (
              <li key={i} className="flex items-center gap-3 text-sm">
                <span className="micro-label w-20 shrink-0 text-white/30">{p.status}</span>
                <a
                  href={p.url}
                  target="_blank"
                  rel="noreferrer"
                  className="break-all text-white/70 underline decoration-white/20 underline-offset-2 hover:text-[#B57BE0]"
                >
                  {p.url}
                </a>
              </li>
            ))}
          </ul>
        </section>

        {/* Methodology + limitations — required on every report */}
        <section className="mt-10 border border-white/10 bg-white/[0.03] p-6 text-sm leading-relaxed text-white/50">
          <h2 className="micro-label accent-purple">Methodology & limitations</h2>
          <p className="mt-4">
            This report was produced by deterministic rules (version{" "}
            <span className="mono accent-purple">{report.methodVersion}</span>), not by an AI model
            deciding what is true. Pass means we directly observed supporting evidence in the pages
            we fetched; Fail means we directly observed a contradiction on the site's own pages;
            Unknown means we could not strongly evidence it either way — and we say so rather than
            guess.
          </p>
          {isDeep && (
            <p className="mt-4 text-white/60">
              This is a deep lookup: up to ~15 pages were fetched (legal / pricing / about / FAQ
              paths plus links discovered on those pages) and claims were extracted from every page
              that loaded. Same rules, same status rubric — just more of the site examined.
            </p>
          )}
          <p className="mt-4 border-t border-white/10 pt-4 text-white/60">
            This is not a legal verdict, not a scam guarantee — we only check public sources. We
            scanned the pages listed above at the time shown; sites change. Absence of a finding is
            not proof a claim is true, and a Pass on one check is not a Pass on the whole site.
          </p>
        </section>
      </div>
    </Shell>
  );
}

function FindingRow({ finding }: { finding: Finding }) {
  return (
    <tr className="border-b border-white/10 align-top last:border-b-0">
      <td className="py-3 pl-4 pr-3 font-semibold text-white/90">{finding.claim}</td>
      <td className="py-3 pr-3">
        <StatusBadge status={finding.status} />
      </td>
      <td className="py-3 pr-3 leading-relaxed text-white/50">{finding.evidence}</td>
      <td className="py-3 pr-3">
        {finding.sources.length === 0 ? (
          <span className="text-white/30">{"\u2014"}</span>
        ) : (
          <ul className="space-y-1">
            {finding.sources.map((s, i) =>
              s.url ? (
                <li key={i}>
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noreferrer"
                    className="block max-w-[220px] truncate text-white/60 underline decoration-white/20 underline-offset-2 hover:text-[#B57BE0]"
                    title={s.url}
                  >
                    {s.label}
                  </a>
                </li>
              ) : (
                <li key={i} className="text-white/40">
                  {s.label}
                </li>
              )
            )}
          </ul>
        )}
      </td>
      <td className="py-3 pr-4 text-white/40">{finding.confidence}</td>
    </tr>
  );
}

function StatusBadge({ status }: { status: Finding["status"] }) {
  const map: Record<Finding["status"], string> = {
    Pass: "border-[#00C853]/40 text-[#00C853]",
    Fail: "border-[#ef4444]/40 text-[#ef4444]",
    Unknown: "border-white/20 text-white/60",
  };
  return (
    <span
      className={`inline-block border px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.2em] ${map[status]}`}
    >
      {status}
    </span>
  );
}

function Span({ dot }: { dot: CheckResult["status"] }) {
  const cls =
    dot === "Pass" ? "bg-[#00C853]" : dot === "Fail" ? "bg-[#ef4444]" : "bg-white/40";
  return <span className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-current ${cls}`} />;
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="border border-white/10 bg-white/[0.03] p-4">
      <div className={`text-2xl font-black tracking-tighter ${tone}`}>{value}</div>
      <div className="micro-label mt-1 text-white/40">{label}</div>
    </div>
  );
}

function MetaPanel({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="border border-white/10 bg-white/[0.03] p-4">
      <div className="micro-label accent-purple">{label}</div>
      <div
        className={`mt-2 break-all text-xs leading-relaxed text-white/70 ${
          mono ? "mono" : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toUTCString();
  } catch {
    return iso;
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

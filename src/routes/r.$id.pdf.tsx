// /r/$id/pdf — print-ready view of a report (the $10 tier's PDF feature).
//
// Simplest honest approach that works end-to-end: a light, print-optimized
// rendering of the full report that auto-triggers the browser's print dialog
// ("Save as PDF" is the destination). No server-side PDF library, no new deps.
// The page also carries a fixed footer so method_version + the core limitation
// appear on every printed page (Chrome/Edge repeat position:fixed elements on
// each printed page — exactly the engines behind "Save as PDF").
import { useEffect } from "react";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import type { Finding, Report } from "~/lib/types";

const loadReport = createServerFn({ method: "GET" })
  .validator((id: string) => id)
  .handler(async ({ data: id }) => {
    if (!/^[a-z0-9-]{6,64}$/.test(id)) return null;
    const { storage } = await import("~/lib/store");
    const record = await storage.loadReport(id);
    return record?.report ?? null;
  });

export const Route = createFileRoute("/r/$id/pdf")({
  component: PdfPage,
  loader: async ({ params }) => {
    const report = await loadReport({ data: params.id });
    if (!report) throw notFound();
    return { report };
  },
  notFoundComponent: () => (
    <div className="p-10 font-sans">
      <p className="text-sm text-neutral-600">
        Report not found. It may have been removed, or the id is wrong.{" "}
        <Link to="/" className="underline">Back to the scanner</Link>
      </p>
    </div>
  ),
});

function PdfPage() {
  const { report } = Route.useLoaderData();

  useEffect(() => {
    // Auto-open the print dialog. The header line tells the visitor to pick
    // "Save as PDF" as the destination — honest framing, nothing hidden.
    const t = setTimeout(() => window.print(), 350);
    return () => clearTimeout(t);
  }, []);

  const isDeep = report.deep === true || report.methodVersion.endsWith("-deep");

  return <PdfBody report={report} isDeep={isDeep} />;
}

function PdfBody({ report, isDeep }: { report: Report; isDeep: boolean }) {
  return (
    <div>
      <style>{printCss}</style>
      <div className="no-print toolbar">
        <div>
          <strong>Print-ready report</strong>
          <span>Use “Save as PDF” as the destination.</span>
        </div>
        <div className="toolbar-actions">
          <Link to={`/r/${report.id}`}>Back to report page</Link>
          <button type="button" onClick={() => window.print()}>Print / Save as PDF</button>
        </div>
      </div>

      <div className="sheet">
        <header className="doc-head">
          <div>
            <h1>{report.targetUrl}</h1>
            <p className="meta">
              Report {report.id} · scanned {fmt(report.scannedAt)} · method {report.methodVersion}
              {isDeep ? " · deep lookup" : ""}
            </p>
            <p className="meta">
              Final URL: {report.finalUrl ?? "(unreachable)"}
            </p>
          </div>
          <div className="badge">Public claim report</div>
        </header>

        {report.scanError && (
          <p className="note">
            Scan note: {report.scanError}
          </p>
        )}

        <section>
          <h2>Findings</h2>
          {report.findings.length === 0 ? (
            <p className="note">No claims were extracted from the pages we fetched.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th className="col-claim">Claim</th>
                  <th className="col-status">Status</th>
                  <th>Evidence</th>
                  <th className="col-source">Source</th>
                  <th className="col-conf">Confidence</th>
                </tr>
              </thead>
              <tbody>
                {report.findings.map((f) => (
                  <PdfFindingRow key={f.id} finding={f} />
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section>
          <h2>Checks</h2>
          <ul className="plain">
            {report.checks.map((c, i) => (
              <li key={i}>
                <strong>{c.label}</strong> — {c.status}. {c.detail}
              </li>
            ))}
          </ul>
        </section>

        {report.unknowns.length > 0 && (
          <section>
            <h2>Could not verify</h2>
            <ul className="plain">
              {report.unknowns.slice(0, 40).map((u, i) => (
                <li key={i}>
                  <strong>{u.claim}.</strong> {u.reason}
                </li>
              ))}
            </ul>
            {report.unknowns.length > 40 && (
              <p className="note">…and {report.unknowns.length - 40} more.</p>
            )}
          </section>
        )}

        <section>
          <h2>What was scanned</h2>
          <p className="note">{report.scope}</p>
          <ul className="plain mono">
            {report.pagesFetched.map((p, i) => (
              <li key={i}>{p.status} — {p.url}</li>
            ))}
          </ul>
        </section>

        <section>
          <h2>Methodology & limitations</h2>
          <p>
            This report was produced by deterministic rules (version {report.methodVersion}), not by
            an AI model deciding what is true. Pass means we directly observed supporting evidence in
            the pages we fetched; Fail means we directly observed a contradiction on the site's own
            pages; Unknown means we could not strongly evidence it either way.
          </p>
          {isDeep && (
            <p>
              This is a deep lookup: up to ~15 pages were fetched (legal / pricing / about / FAQ
              paths plus links discovered on those pages) and claims were extracted from every page
              that loaded.
            </p>
          )}
          <p>
            This is not a legal verdict, not a scam guarantee — we only check public sources. We
            scanned the pages listed above at the time shown; sites change. Absence of a finding is
            not proof a claim is true, and a Pass on one check is not a Pass on the whole site.
          </p>
        </section>
      </div>

      {/* Repeats on every printed page (Chrome/Edge "Save as PDF"). */}
      <div className="print-footer">
        Integrity by 3Two Studios — {report.id} · method {report.methodVersion} · not a legal
        verdict, not a scam guarantee · public sources only · scanned {fmt(report.scannedAt)}
      </div>
    </div>
  );
}

function PdfFindingRow({ finding }: { finding: Finding }) {
  return (
    <tr>
      <td className="col-claim"><strong>{finding.claim}</strong></td>
      <td className="col-status"><span className={`st st-${finding.status.toLowerCase()}`}>{finding.status}</span></td>
      <td>{finding.evidence}</td>
      <td className="col-source">
        {finding.sources.length === 0
          ? "—"
          : finding.sources.map((s) => s.url ?? s.label).join(" · ")}
      </td>
      <td className="col-conf">{finding.confidence}</td>
    </tr>
  );
}

function fmt(iso: string): string {
  try {
    return new Date(iso).toUTCString();
  } catch {
    return iso;
  }
}

const printCss = `
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #e5e5e5; }
  body { color: #111; font-family: "Inter", ui-sans-serif, system-ui, Arial, sans-serif; font-size: 12px; line-height: 1.45; }
  .toolbar {
    display: flex; align-items: center; justify-content: space-between; gap: 16px;
    background: #0a0a1f; color: #fff; padding: 12px 20px; position: sticky; top: 0; z-index: 5;
  }
  .toolbar strong { display: block; font-size: 14px; letter-spacing: 0.02em; }
  .toolbar span { font-size: 11px; color: #cbb2e5; }
  .toolbar-actions { display: flex; gap: 8px; align-items: center; }
  .toolbar a { color: #b57be0; font-size: 11px; text-decoration: underline; }
  .toolbar button {
    background: #b57be0; color: #0a0a1f; border: 0; font-weight: 700; font-size: 11px;
    padding: 7px 14px; cursor: pointer; text-transform: uppercase; letter-spacing: 0.08em;
  }
  .sheet { background: #fff; max-width: 820px; margin: 24px auto; padding: 28px 32px; box-shadow: 0 1px 4px rgba(0,0,0,0.18); }
  .doc-head { display: flex; justify-content: space-between; gap: 12px; border-bottom: 2px solid #0a0a1f; padding-bottom: 12px; }
  .doc-head h1 { font-size: 18px; margin: 0 0 6px; word-break: break-all; letter-spacing: -0.01em; }
  .meta { margin: 2px 0; font-size: 11px; color: #444; word-break: break-all; }
  .badge { align-self: flex-start; border: 1px solid #0a0a1f; padding: 3px 8px; font-size: 10px; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase; white-space: nowrap; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.14em; margin: 22px 0 8px; color: #0a0a1f; }
  .note { font-size: 11.5px; color: #333; background: #f2f2f2; padding: 8px 10px; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th, td { border: 1px solid #bbb; padding: 5px 7px; vertical-align: top; text-align: left; font-size: 11px; word-break: break-word; }
  th { background: #0a0a1f; color: #fff; font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; }
  .col-claim { width: 24%; }
  .col-status { width: 9%; }
  .col-source { width: 18%; }
  .col-conf { width: 11%; }
  .st { display: inline-block; padding: 2px 6px; font-size: 10px; font-weight: 800; border: 1px solid #999; }
  .st-pass { color: #0a7a34; border-color: #0a7a34; }
  .st-fail { color: #b91c1c; border-color: #b91c1c; }
  .st-unknown { color: #555; border-color: #555; }
  ul.plain { margin: 0; padding-left: 16px; }
  ul.plain li { margin: 3px 0; }
  ul.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10.5px; }
  .print-footer {
    position: fixed; bottom: 0; left: 0; right: 0;
    font-size: 8.5px; color: #555; background: #fff;
    border-top: 1px solid #ccc; padding: 4px 10px;
  }
  @media print {
    html, body { background: #fff !important; }
    @page { size: A4; margin: 12mm 10mm 14mm 10mm; }
    .toolbar, .no-print { display: none !important; }
    .sheet { box-shadow: none; margin: 0; max-width: none; padding: 0; }
    .doc-head h1 { font-size: 16px; }
    tr { break-inside: avoid; page-break-inside: avoid; }
    thead { display: table-header-group; }
    h2 { break-after: avoid; }
  }
`;

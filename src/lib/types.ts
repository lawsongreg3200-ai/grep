// Shared types for the Integrity claim auditor.

export type FindingStatus = "Pass" | "Fail" | "Unknown";

export type Confidence = "High" | "Medium" | "Low";

export interface SourceRef {
  label: string;
  url?: string;
}

export interface Finding {
  id: string;
  /** Human-readable claim sentence, e.g. "Serves over HTTPS" */
  claim: string;
  status: FindingStatus;
  /** Why this status. For Unknown this is the reason it could not be verified. */
  evidence: string;
  /** Source page(s) the evidence came from (public sources only). */
  sources: SourceRef[];
  confidence: Confidence;
  /** Which check category produced this finding. */
  category:
    | "domain"
    | "pages"
    | "pricing"
    | "metrics"
    | "testimonials"
    | "press"
    | "guarantees"
    | "contradictions"
    | "third-party scripts"
    | "reviews";
}

export interface CheckResult {
  label: string;
  status: "Pass" | "Fail" | "Unknown";
  detail: string;
}

export interface ClaimSpot {
  text: string;
  pageUrl: string;
  snippet: string;
}

export interface ScanOptions {
  /** Include a compact summary of checks that passed cleanly (used for the optional self-audit page). */
  includePassChecks?: boolean;
  /** Deep lookup (the $10 tier feature): fetch up to ~15 pages (legal/pricing/
   *  about/FAQ paths + links discovered on pages) and extract claims from all
   *  of them. The report's methodVersion gets a "-deep" suffix. */
  deep?: boolean;
}

export type ScanStatus = "queued" | "running" | "complete" | "error";

export interface ScanProgress {
  id: string;
  status: ScanStatus;
  step: string;
  /** 0..1 fraction of the pipeline done */
  progress: number;
  error?: string;
}

export interface Report {
  id: string;
  targetUrl: string;
  finalUrl: string | null;
  scannedAt: string;
  methodVersion: string;
  /** True when this report came from a deep lookup ($10 tier): ~15 pages scanned.
   *  Absent/undefined on older reports (standard scan). */
  deep?: boolean;
  /** What was scanned and any fetch problems (documented, never hidden). */
  scope: string;
  /** Hard scan errors that prevented a report (unreachable site, timeout, size cap). */
  scanError: string | null;
  /** Summary checks (HTTPS, Pricing page present, etc.). */
  checks: CheckResult[];
  /** Full findings table — the product. */
  findings: Finding[];
  /** Pages that were actually fetched. */
  pagesFetched: { url: string; status: number }[];
  /** What could not be verified (mirrors Unknown findings with reasons). */
  unknowns: { claim: string; reason: string }[];
  /** Public sources of each raw snapshot kept on disk. */
  snapshotRefs: { pageUrl: string; storedAt: string | null }[];
}

export interface ReportRecord {
  report: Report;
  claims: ClaimSpot[];
  snapshot: { [pageUrl: string]: { html: string; fetchedAt: string } };
}
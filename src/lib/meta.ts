// Pure constants — safe to import from client code (no node builtins).

export const METHOD_VERSION = "2026-09-06.2";

/** Suffix appended to method_version when a report was produced by a deep
 *  lookup (the $10 tier feature): fetches up to ~15 pages instead of ~4 and
 *  extracts claims from all of them. */
export const DEEP_METHOD_SUFFIX = "-deep";

export const SCAN_STEPS = [
  "Resolving target URL",
  "Fetching homepage",
  "Checking Pricing / Terms / Privacy pages",
  "Extracting claims",
  "Cross-checking pages for contradictions",
  "Compiling report",
] as const;

/** Deep lookups add one more phase (fetching discovered pages) between the
 *  legal-page check and claim extraction, so progress has 7 steps. */
export const DEEP_SCAN_STEPS = [
  ...SCAN_STEPS.slice(0, 3),
  "Fetching discovered pages",
  ...SCAN_STEPS.slice(3),
] as const;
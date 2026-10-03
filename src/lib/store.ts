// Storage interface for Integrity reports. File-based for now (no DATABASE_URL in
// the sandbox); swap to Postgres later by reimplementing this same surface
// (saveReport / loadReport / reportExists).

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { Report, ReportRecord } from "./types";

const ROOT = process.env.INTEGRITY_DATA_DIR ?? "/home/team/shared/data";

const reportsDir = () => join(ROOT, "reports");
const snapshotsDir = () => join(ROOT, "snapshots", "v1");
const rawClaimsDir = () => join(ROOT, "raw-claims", "v1");

function ensureDirs() {
  for (const d of [ROOT, reportsDir(), snapshotsDir(), rawClaimsDir()]) {
    try {
      mkdirSync(d, { recursive: true, mode: 0o775 });
    } catch {
      // directory already exists — fine
    }
  }
}

/** Filesystem-safe 1:1 encoding of a URL for snapshot filenames (base64url). */
function safeFileName(url: string): string {
  return Buffer.from(url, "utf8").toString("base64url").slice(0, 140);
}

function restoreFileName(enc: string): string {
  try {
    return Buffer.from(enc, "base64url").toString("utf8");
  } catch {
    return enc;
  }
}

export interface Storage {
  saveReport(record: ReportRecord): Promise<void>;
  loadReport(id: string): Promise<ReportRecord | null>;
  reportExists(id: string): boolean;
}

export const storage: Storage = {
  async saveReport(record: ReportRecord) {
    ensureDirs();
    const id = record.report.id;
    const snapDir = join(snapshotsDir(), id);
    mkdirSync(snapDir, { recursive: true, mode: 0o775 });
    for (const [pageUrl, snap] of Object.entries(record.snapshot)) {
      writeFileSync(join(snapDir, `${safeFileName(pageUrl)}.html`), snap.html, "utf8");
    }
    writeFileSync(join(reportsDir(), `${id}.json`), JSON.stringify(record.report), "utf8");
    writeFileSync(
      join(rawClaimsDir(), `${id}.json`),
      JSON.stringify({ id, claims: record.claims ?? [] }),
      "utf8"
    );
  },

  async loadReport(id: string): Promise<ReportRecord | null> {
    if (!/^[a-z0-9-]{6,64}$/.test(id)) return null;
    const path = join(reportsDir(), `${id}.json`);
    if (!existsSync(path)) return null;
    try {
      const report = JSON.parse(readFileSync(path, "utf8")) as Report;
      if (!report || typeof report.id !== "string" || report.id !== id) return null;

      let claims: ReportRecord["claims"] = [];
      try {
        const rawPath = join(rawClaimsDir(), `${id}.json`);
        if (existsSync(rawPath)) {
          const parsed = JSON.parse(readFileSync(rawPath, "utf8")) as { claims?: ReportRecord["claims"] };
          claims = Array.isArray(parsed.claims) ? parsed.claims : [];
        }
      } catch {
        // structured claims missing — report still loads
      }

      // Read snapshot HTML files back from disk for provenance.
      const snapshot: ReportRecord["snapshot"] = {};
      const snapDir = join(snapshotsDir(), id);
      if (existsSync(snapDir)) {
        for (const name of readdirSync(snapDir)) {
          if (!name.endsWith(".html")) continue;
          try {
            const full = join(snapDir, name);
            if (statSync(full).size <= 2.5 * 1024 * 1024) {
              snapshot[restoreFileName(name.replace(/\.html$/, ""))] = {
                html: readFileSync(full, "utf8"),
                fetchedAt: "",
              };
            }
          } catch {
            // skip unreadable snapshot
          }
        }
      }

      return { report, claims, snapshot };
    } catch {
      return null;
    }
  },

  reportExists(id: string): boolean {
    return existsSync(join(reportsDir(), `${id}.json`));
  },
};

export function deleteReport(id: string) {
  try {
    rmSync(join(reportsDir(), `${id}.json`), { force: true });
    rmSync(join(snapshotsDir(), id), { recursive: true, force: true });
    rmSync(join(rawClaimsDir(), `${id}.json`), { force: true });
  } catch {
    // best effort
  }
}

export { ROOT as dataRoot };
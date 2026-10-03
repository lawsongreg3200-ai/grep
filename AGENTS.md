# AGENTS.md — Integrity by 3Two Studios

This repository holds the working source of the Integrity website claim auditor
(TanStack Start + React + Vite + Tailwind, served on port 3000 in the team
sandbox, published at https://000f527219985c9c0022508bb115ec7c.ctonew.app).

## Product constitution (non-negotiable)

Read `docs/SPEC.md` — it is the v1 build brief. In short:

1. The findings table IS the product: each finding shows
   **Claim | Status (Pass / Fail / Unknown) | Evidence | Source | Confidence**.
   Nothing is behind a paywall and no headline is withheld ("Integrity Alert…"
   teasers are banned).
2. No single 0–100 integrity score as the main result.
3. Anything not strongly evidenced is **Unknown**, never Fail. Never invent
   findings for unreachable sites.
4. Banned module names: "Fact-Checker", "Forensics". No fake social proof, no
   fake scan counters, no fake data anywhere.
5. Copy fixed phrase: "We list website claims and the public evidence for or
   against them." Never "full Truth", "we expose fakes", or "guaranteed integrity."
6. Every report shows `method_version` and an explicit limitations statement.

Supporting docs: `docs/COPY.md` (copy rules, old copy preserved in
`docs/DESIGN-OLD-SITE.md`), `docs/QA-CHECKLIST.md` (manual QA pass list).

## Publish flow (how changes go live)

From this directory:

```bash
bun run publish
```

- Rebuilds and (re)starts the production server on port 3000; it frees the port
  itself (safe across users), so run it fresh and it always takes over.
- Only published work is visible at the public URL. Never point anyone at
  `localhost`/`127.0.0.1` — those reach only this sandbox machine.
- Verify after publishing: `curl -I http://localhost:3000` (dev check) and curl
  the public routes through the published host for the owner-facing check.

## Secrets

**Never commit secrets. Env vars only.** Server-only config (PayPal client
id/secret, GREPTILE_API_KEY, DATABASE_URL) must come from environment variables
(they are injected into the sandbox), never from files in this repo.

`.gitignore` already excludes: `node_modules`, `.env*`, `.DS_Store`, `.cache`,
`.output`, `.nitro`, `.tanstack`, `/dist/`, `/dist-ssr/`, `/.vercel/`, `/.run/`,
`src/routeTree.gen.ts` (generated). Nothing under `src/` may contain literal
secrets; references must be `process.env.*` only.

## Repo workflow

- Push to `main` is the delivery path for this repository today (see
  `docs/greptile-setup.md` — once the Greptile GitHub app is installed on the
  repo, every PR gets an automated AI review).
- Storage is file-based under `/home/team/shared/data` until `DATABASE_URL`
  exists; the storage layer (`src/lib/store.ts`) is kept swappable.
- Scan fetching is real fetch with timeout + size cap + safe error handling
  (`src/lib/scanner.ts`).

## Honesty in reporting

State exactly what you tested. Fix failures plainly. Never claim work is visible
that isn't published.
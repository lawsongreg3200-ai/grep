# Robo Deebo — Convex backend

Scaffold for the Convex Cloud backend: a durable database, a genuinely public
HTTPS REST surface, and scheduled functions so the email watcher runs on a timer
instead of only when someone presses **SYNC NOW**.

> **Status: deployed to the DEV deployment (`modest-donkey-711`), not production,
> and not reachable yet.** The phishing scorer is ported and runs; the IMAP fetch
> and the URL-reputation check are not. `DEEBO_API_KEY` is still unset on the
> deployment, so every HTTP route returns 401 by design and no endpoint has been
> exercised end-to-end. The site's runtime does not call any of this.

---

## What is in here

| File | What it does |
| --- | --- |
| `schema.ts` | Tables: `messages`, `scans`, `watches`, `users`. |
| `chat.ts` | `recordTurn` / `appendMessage` (internal mutations), `transcript` (internal query), and `replyFor()` — the seam where the ELITE responder drops in. |
| `watch.ts` | The authenticated HTTP surface (`/chat`, `/watch/run`, `/health`) plus `runWatchPass` (the scheduled scan pass) and `saveWatch`. |
| `http.ts` | Mount point — Convex looks for this file and takes its default export as the router. It just re-exports the router from `watch.ts`. |
| `crons.ts` | Runs `runWatchPass` every 5 minutes. |
| `lib/secrets.ts` | AES-256-GCM sealing for the email app password before it is stored in `watches`. |
| `lib/phishing.ts` | **Ported** phishing heuristic scorer — pure functions, Web-standard APIs only, no network / no env vars. Faithful port of `src/lib/phishing.ts`. |
| `scripts/score_fixtures.ts` | Dev tool: scores four fixtures with the ported module, no deployment needed. `bun run convex/scripts/score_fixtures.ts`. |

Everything in `chat.ts` is `internal*`: the **only** public door is the HTTP
router, and every route on it requires the shared secret. The deployment's
`.cloud` client API therefore exposes no callable function — deliberate, until
real client auth exists.

### Why these three things (and not "because it's a backend")
1. **Durable database** — `data/deebo.db` (SQLite) lives on the sandbox disk and
   dies with it. Chat transcripts and scan history should outlive a restart.
2. **Public HTTPS REST** — `src/lib/server.ts` is `createServerFn` RPC, callable
   only from the page that shipped it. Nothing outside the browser can talk to
   Deebo. `/chat` and `/watch/run` are that door.
3. **Cron** — today the watcher runs only when the page asks. `crons.ts` makes it
   run whether or not a browser is open.

---

## Deploying (the only remaining step)

Two environment variables are needed:

| Variable | Where it lives | What it is |
| --- | --- | --- |
| `CONVEX_DEPLOY_KEY` | your shell / CI secret store | Deployment key from the Convex dashboard (Project → Settings → Deploy keys, with the `deployment:deploy` permission). Used by the CLI to push code. |
| `DEEBO_API_KEY` | the **Convex deployment's** env vars | The shared secret callers must send as `X-Deebo-Key`. Set with the CLI, not in a file. |

Optional, only for saving an email connection (`watches.saveWatch`):
`DEEBO_SECRET_KEY` (min 16 chars) — the passphrase the app password is sealed
with. Without it `saveWatch` throws and refuses to store a plaintext secret.

```bash
cd /home/team/shared/site

# 1. Set the caller secret on the deployment (needs the deployment configured once).
npx convex env set DEEBO_API_KEY <long-random-value>
npx convex env set DEEBO_SECRET_KEY <long-random-value>   # optional, for watches

# 2. Push code + schema + crons. This is the whole deploy.
CONVEX_DEPLOY_KEY=<key> npx convex deploy
```

The first `deploy` also creates `convex/_generated/` (types) and
`convex.json`; commit `convex/_generated/` (Convex expects it in the repo).

Verify after deploy:

```bash
curl -s https://<deployment>.convex.site/health -H "X-Deebo-Key: $DEEBO_API_KEY"
# → {"ok":true,"service":"robo-deebo","time":"..."}
```

---

## URL shapes

Two different hosts, and mixing them up is the usual first mistake:

| Host | Serves | Use for |
| --- | --- | --- |
| `https://<deployment>.convex.site` | **HTTP actions only** (this router) | `/chat`, `/watch/run`, `/health` — the public REST surface |
| `https://<deployment>.convex.cloud` | the client API (queries/mutations/actions) | a Convex client (`ConvexClient`/`ConvexReactClient`), later |

So the public endpoints are:

```
GET  https://<deployment>.convex.site/health      → { ok, service: "robo-deebo", time }
POST https://<deployment>.convex.site/chat        → { ok, sessionId, reply }
POST https://<deployment>.convex.site/watch/run   → { ok, scanned, flagged, unscored }
```

All three require:

```
X-Deebo-Key: <DEEBO_API_KEY>
```

Missing or wrong key ⇒ `401 {"ok":false,"error":"unauthorized"}`. If
`DEEBO_API_KEY` is unset on the deployment, every route returns 401 — it fails
closed, never open.

### `POST /chat`

```bash
curl -s https://<deployment>.convex.site/chat \
  -H "X-Deebo-Key: $DEEBO_API_KEY" \
  -H "content-type: application/json" \
  -d '{"sessionId":"demo-1","message":"is this email a scam?"}'
# → {"ok":true,"sessionId":"demo-1","reply":"..."}
```

Persists the user turn, generates a reply, persists that too, returns the reply.
The reply today is a **deterministic placeholder** from `replyFor()` in
`chat.ts` — it says plainly that the real responder is not wired. Replace
`replyFor` with the ELITE responder (port of `eliteReply()` in
`src/components/DeeboChat.tsx`) and every caller upgrades at once; no other
file changes.

### `POST /watch/run`

```bash
curl -s -X POST https://<deployment>.convex.site/watch/run \
  -H "X-Deebo-Key: $DEEBO_API_KEY"
# → {"ok":true,"scanned":0,"flagged":0,"unscored":1}
```

Runs one watch pass now (same code path the cron uses). It walks the enabled
`watches`, stamps `lastRunAt`, and **scores every message it is handed** via
`args.messages` (see `runWatchPass`), writing the real verdict and score into
`scans`.

The HTTP route and the cron pass **no messages**, because IMAP is not ported
yet — so today they write one `scans` row with `verdict: "unscored"`. That is
intentional and honest: nothing was fetched, so nothing was scored, so it must
never read as an all-clear. Counts: `scanned` = messages actually scored,
`flagged` = those landing `phish` or `suspect`, `unscored` = messages with no
content to score.

---

## What is NOT done yet

### 1. The email-watch pipeline is HALF ported: scoring yes, fetching no
**Done:** `src/lib/phishing.ts` `scoreEmail()` → `convex/lib/phishing.ts`, a
pure, dependency-free port (no network, no `process.env`, Web APIs only). Same
signal set, same weights, same thresholds, same explanation voice — verified
byte-identical on 7 fixtures (3 `SAMPLE_EMAILS` + 4 hand-built) against the site
module: same score, band, certainty, action, explanation and signal array.
`runWatchPass` scores every message in `args.messages` and writes the real
verdict (`Low ⇒ safe`, `Medium ⇒ suspect`, `High|Critical ⇒ phish`, identical
to `src/lib/imap.ts`), deduped on `by_message_id`.

**Not done — marked `TODO(port)` in `watch.ts`:**
- `src/lib/imap.ts` `runEmailSync()` — the actual fetch. Needs the owner's real
  email connection, which we do not have. When it lands, `runWatchPass` becomes
  an `action` with `"use node"` (imapflow needs real sockets) that fetches, then
  calls the scoring mutation with the parsed messages. Until then the cron and
  `POST /watch/run` have no messages to score and record `"unscored"`.
- `src/lib/urlcheck.ts` — Google Safe Browsing per link. Needs the deployment
  env var `SAFEBROWSING_API_KEY`, which cannot be set yet (the deploy key we
  have carries only `deployment:deploy`). Link scoring today is heuristic-only.

### 2. The ELITE responder is not ported
See `replyFor()` in `chat.ts`. The live behaviour to port is `eliteReply()`:
Executive Summary / Facts / Analysis / Risks / Recommendations / Confidence /
Assumptions, with the failsafe "Insufficient evidence for a reliable
conclusion." and Confidence Level: Moderate + validation call on uncertainty.

### 3. Accounts are not migrated
`users` mirrors the account model (`handle`, `name`, `role`) but Convex holds
**no credentials**. `src/lib/auth.ts` (scrypt + HMAC session cookie) remains the
only auth. Nothing scopes a chat session to a user yet — `sessionId` is opaque
and caller-supplied, which is fine only because the endpoint is key-gated.

### 4. The site does not call Convex
`src/lib/server.ts`, `serve.ts`, the routes and `data/deebo.db` are untouched.
Cutting the site over to `/chat` is a separate, reversible change.

---

## Checking the scorer without a deployment
The scorer is pure, so it needs neither a deployment nor a key:
```bash
cd /home/team/shared/site
bun run convex/scripts/score_fixtures.ts
```
It scores four fixtures with the same module `runWatchPass` calls — an obvious
phishing email (expect `phish`), a benign newsletter (`safe`), a borderline
vendor dunning mail (`suspect`) and an empty message (`unscored`, never `safe`)
— and exits non-zero if any lands outside its expected verdict.
---
## Typechecking (important)

`convex/_generated/` — the generated types every file here imports — **does not
exist until codegen runs against a real deployment**. `npx convex codegen`
refuses without one:

```
✖ No CONVEX_DEPLOYMENT set, run `npx convex dev` to configure a Convex project
```

and a made-up deployment name is rejected by the API (`InvalidDeploymentName`).
So there is no offline path to generated types.

Consequence: the app's `tsc --noEmit` **excludes** `convex/` (see the root
`tsconfig.json`), and `convex/` typechecks with its own project once a deploy
key exists:

```bash
cd /home/team/shared/site
CONVEX_DEPLOY_KEY=<key> npx convex codegen     # writes convex/_generated/
cd convex && npx tsc --noEmit                  # now typechecks for real
```

Until then the function bodies were checked against a local stand-in for
`_generated` (the same generics `convex/server` exports, uncommitted), which
catches syntax, import and validator errors — **not** table/column mistakes,
because the stand-in's `ctx.db` is loosely typed. Column-level checking happens
on the first codegen.

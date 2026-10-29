# Robo Deebo — Convex backend

Scaffold for the Convex Cloud backend: a durable database, a genuinely public
HTTPS REST surface, and scheduled functions so the email watcher runs on a timer
instead of only when someone presses **SYNC NOW**.

> **Status: written, not deployed, not exercised.** There is no Convex deploy
> key yet, so none of these endpoints has ever run. Nothing here is live, and
> the site's runtime does not call it. Treat every claim in this file as
> "intended behaviour, to be verified on first deploy".

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
POST https://<deployment>.convex.site/watch/run   → { ok, scanned, flagged }
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
# → {"ok":true,"scanned":0,"flagged":0}
```

Runs one watch pass now (same code path the cron uses). Today it walks the
enabled `watches`, stamps `lastRunAt`, and writes one `scans` row with
`verdict: "unscored"` — honest, because **nothing is fetched or scored yet**.
`scanned`/`flagged` are hard-coded `0` until the pipeline is ported.

---

## What is NOT done yet

### 1. The email-watch pipeline is not ported
`runWatchPass` has a marked `TODO(port)` block. To finish it:
- `src/lib/imap.ts` `runEmailSync()` → becomes an `action` with `"use node"`
  (imapflow needs real sockets); DB writes move into the mutation.
- `src/lib/phishing.ts` `scoreEmail()` → per-message score, band, explanation.
- `src/lib/urlcheck.ts` → Google Safe Browsing per link.
- One `scans` row per message, deduped on `by_message_id` (Message-ID is the
  identity, same rule as SQLite).

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

# Greptile setup — repository indexing & AI PR review

Status: **API-side setup attempted; owner onboarding step still required.**

## What was done (session: repo push + Greptile wiring)

1. Pushed the Integrity by 3Two Studios v1 source to
   `https://github.com/lawsongreg3200-ai/grep` (branch `main`, HEAD
   `13af6999c15caf8ba4bdb5187b7f0e068c56f163` before this doc was added).
2. Attempted to trigger Greptile indexing via the documented API endpoint:
   `POST https://api.greptile.com/v2/github/repositories` with
   `{"remote":"github","repository":"lawsongreg3200-ai/grep","branch":"main"}`
   (Authorization: Bearer `<GREPTILE_API_KEY>`, X-Github-Token set from the
   sandbox GitHub token).

## Response from the exact endpoint above (recorded verbatim)

HTTP 404:

```json
{"type":"https://docs.greptile.com/errors/unknown_endpoint","title":"Not Found","status":404,"detail":"No route matches POST /v2/github/repositories.","instance":"/v3/requests/302a5c20-4f06-42c2-97c5-198167c4e320","code":"unknown_endpoint","requestId":"302a5c20-4f06-42c2-97c5-198167c4e320","target":"/v2/github/repositories"}
```

Probing the API confirmed the manual-indexing API is **retired**. The current
route `POST /v2/repositories` returns HTTP 410 Gone:

```json
{"error":"repository_indexing_retired","message":"Manual repository indexing and indexing-status polling have been retired. Connected repositories are synchronized automatically, so these endpoints no longer need to be called.","action":"Remove repository indexing and indexing-status API calls from your integration. To connect or enable a repository, use Greptile's repository onboarding flow."}
```

## What this means

Greptile no longer supports API-triggered repository indexing. Indexing is
automatic **once the repository is connected** to Greptile. There is therefore
no API call the team can make to index `lawsongreg3200-ai/grep` — the repo is
not yet connected because the Greptile GitHub app has not been installed on it.

## Exact next step for the owner (only the owner can do this)

1. Open the Greptile dashboard (https://app.greptile.com — same account as the
   `GREPTILE_API_KEY`).
2. Go to the repository onboarding flow ("Connect repository" / Add repo) and
   choose `lawsongreg3200-ai/grep`.
3. Grant access / install the **Greptile GitHub app** on the
   `lawsongreg3200-ai` account for the `grep` repository (all repos is fine
   too). This is the required onboarding step.
4. Once connected, Greptile synchronizes the repo automatically. **After that,
   every pull request on the repo gets an automated AI code review.** No code
   changes or API calls are needed on our side.

## Verification after onboarding (optional, for whoever follows up)

- Open a PR against `main` — Greptile's review should appear automatically.
- Or check the repository status in the Greptile dashboard (indexing appears
  as "completed" once the sync finishes).

## Notes

- Do NOT retry `POST /v2/github/repositories` or `POST /v2/repositories` — the
  first is 404, the second is 410 (retired) until the repo is connected; even
  after connection, no manual index call is needed.
- `GREPTILE_API_KEY` lives in the sandbox environment (injected via
  `/etc/profile.d/cto-env-vars.sh`); it must never be committed to the repo.
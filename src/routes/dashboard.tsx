import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { DeeboAvatar } from "~/components/DeeboAvatar";
import { DeeboChat } from "~/components/DeeboChat";
import { getSystemStatus, saveConnection, loadConnection, type SystemStatus, type ConnectionLoaded } from "~/lib/server";
import {
  SAMPLE_EMAILS,
  scoreEmail,
  eliteAssessment,
  bandColor,
  type ParsedEmail,
  type ScoreResult,
} from "~/lib/phishing";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Robo Deebo — Copilot Dashboard · Free Beta" },
      {
        name: "description",
        content:
          "Robo Deebo's protection-copilot dashboard. Invite-gated free beta: connect your email, watch Inbox Patrol, and trash-talk with Deebo while he takes names.",
      },
    ],
  }),
  component: Dashboard,
});

const BETA_KEY = "deebo.beta.v1";
const SETTINGS_KEY = "deebo.settings.v1";
const INTENTS_KEY = "deebo.intents.v1";
const FALLBACK_BETA = "DEEBO-BETA-2026";

type Tab = "inbox" | "chat" | "settings";
type Intent = "approve" | "dismiss";

interface SavedConn {
  provider: string;
  email: string;
  hasPassword: boolean;
  mode: "db" | "local";
}

function readLS<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function writeLS(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* private mode etc — settings just won't persist */
  }
}

function Dashboard() {
  const [gate, setGate] = useState<"loading" | "locked" | "open">("loading");
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [tab, setTab] = useState<Tab>("inbox");

  /* ---------------- beta gate ---------------- */
  const [code, setCode] = useState("");
  const [gateErr, setGateErr] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let s: SystemStatus | null = null;
      try {
        s = await getSystemStatus();
      } catch {
        /* server fn unavailable — revert to client defaults */
      }
      if (cancelled) return;
      setStatus(s);
      const granted = readLS<string>(BETA_KEY) === "granted";
      setGate(granted ? "open" : "locked");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const submitCode = async (e: FormEvent) => {
    e.preventDefault();
    const expected = status?.betaCode || FALLBACK_BETA;
    if (code.trim().toUpperCase() === expected.trim().toUpperCase()) {
      setChecking(true); // tiny beat for feel, then grant
      setTimeout(() => {
        writeLS(BETA_KEY, "granted");
        setGate("open");
      }, 450);
    } else {
      setGateErr("Wrong passcode. That invite code ain't in the yearbook, friend.");
    }
  };

  /* ---------------- settings / connection ---------------- */
  const [savedConn, setSavedConn] = useState<SavedConn | null>(null);
  const [form, setForm] = useState({ provider: "gmail", email: "", appPassword: "" });
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  useEffect(() => {
    if (gate !== "open") return;
    let cancelled = false;
    (async () => {
      let dbConn: ConnectionLoaded | null = null;
      try {
        dbConn = await loadConnection();
      } catch {
        dbConn = null;
      }
      const local = readLS<{ provider?: string; email?: string; appPassword?: string; mode?: string }>(SETTINGS_KEY);
      if (cancelled) return;
      if (dbConn) {
        setSavedConn({ provider: dbConn.provider, email: dbConn.email, hasPassword: dbConn.hasPassword, mode: "db" });
        setForm((f) => ({ ...f, provider: dbConn.provider, email: dbConn.email }));
      } else if (local?.email) {
        setSavedConn({ provider: local.provider ?? "gmail", email: local.email, hasPassword: !!local.appPassword, mode: (local.mode as "db" | "local") ?? "local" });
        setForm((f) => ({ ...f, provider: local.provider ?? "gmail", email: local.email }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [gate]);

  const emailConnected = !!(
    status?.emailConfigured || (savedConn?.email && savedConn.hasPassword)
  );

  const submitSettings = async (e: FormEvent) => {
    e.preventDefault();
    setSaveNote(null);
    setSaveErr(null);
    const payload = { provider: form.provider as "gmail" | "outlook" | "other", email: form.email, appPassword: form.appPassword };
    try {
      const res = await saveConnection({ data: payload });
      if (res.mode === "db") {
        writeLS(SETTINGS_KEY, { provider: payload.provider, email: payload.email, mode: "db" });
        setSavedConn({ provider: payload.provider, email: payload.email, hasPassword: !!payload.appPassword, mode: "db" });
      } else {
        writeLS(SETTINGS_KEY, { ...payload, mode: "local" });
        setSavedConn({ provider: payload.provider, email: payload.email, hasPassword: !!payload.appPassword, mode: "local" });
      }
      setForm((f) => ({ ...f, appPassword: "" }));
      setSaveNote(res.note);
    } catch {
      setSaveErr("Couldn't reach the server right now — try again in a moment.");
    }
  };

  /* ---------------- inbox intent tracking ---------------- */
  const [intents, setIntents] = useState<Record<string, Intent>>({});
  useEffect(() => {
    const saved = readLS<Record<string, Intent>>(INTENTS_KEY);
    if (saved) setIntents(saved);
  }, []);
  const markIntent = (id: string, v: Intent) => {
    const next = { ...intents, [id]: v };
    setIntents(next);
    writeLS(INTENTS_KEY, next);
  };

  /* ---------------- scored samples (deterministic, client-side) ---------------- */
  const scores = useMemo(
    () =>
      SAMPLE_EMAILS.map((email) => ({ email, result: scoreEmail(email) })).sort(
        (a, b) => b.result.score - a.result.score
      ),
    []
  );
  const top = scores[0];

  /* ---------------- dashboard-aware chat hook ---------------- */
  const dashboardReply = useCallback(
    (raw: string): string | null => {
      const t = raw.toLowerCase();
      const aboutMail =
        ["inbox", "email", "mail", "message", "phish"].some((k) => t.includes(k)) &&
        ["what", "how", "any", "risk", "watch", "status", "scan", "count", "score"].some((k) => t.includes(k));
      if (!aboutMail) return null;
      if (emailConnected)
        return `Inbox watch is connected, but I haven't scanned a single real message yet — live sync is still being wired up. Sneak preview (sample data): ${scores.length} demo messages on my bench; top risk is ${top ? top.result.band : "n/a"}: "${top ? top.email.subject : ""}".`;
      return "No inbox to watch yet — plug me in and I'll start taking names. Head to Settings, drop in your email + app password, and Inbox Patrol goes live.";
    },
    [emailConnected, scores, top]
  );

  /* ---------------- render ---------------- */
  if (gate === "loading") {
    return (
      <div className="grid min-h-dvh place-items-center bg-night text-ink">
        <p className="font-display text-lg text-dim">checking the yearbook…</p>
      </div>
    );
  }

  if (gate === "locked") {
    return (
      <div className="relative min-h-dvh overflow-hidden bg-night text-ink">
        <div className="dot-grid absolute inset-0" aria-hidden />
        <div className="relative mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-6 py-16 text-center">
          <div className="glow-float h-24 w-24 overflow-hidden rounded-full border-4 border-signal">
            <DeeboAvatar className="h-full w-full" />
          </div>
          <p className="mt-6 font-marker text-2xl text-blaze">hold up. who's this?</p>
          <h1 className="mt-1 font-display text-4xl text-ink sm:text-5xl">
            COPILOT <span className="text-signal">BETA</span>
          </h1>
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-dim">
            The dashboard is in a free, invite-only beta. Enter the code from your invite — no real
            accounts yet, just a locked gym door and Deebo checking IDs.
          </p>
          <form onSubmit={submitCode} className="mt-8 w-full">
            <input
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                setGateErr(null);
              }}
              placeholder="INVITE CODE"
              aria-label="Invite code"
              className="h-14 w-full rounded-2xl border-2 border-edge bg-panel-2 px-4 text-center font-display text-lg tracking-[0.2em] text-ink placeholder:text-dim/40 focus:border-signal focus:outline-none"
            />
            {gateErr && <p className="mt-3 font-marker text-sm text-blaze">{gateErr}</p>}
            <button
              type="submit"
              disabled={checking}
              className="mt-4 w-full rounded-2xl py-4 font-display text-sm tracking-wide text-night transition-transform hover:scale-[1.02] active:scale-95 disabled:opacity-60"
              style={{ backgroundColor: "var(--color-signal)" }}
            >
              {checking ? "CHECKING…" : "ENTER THE BETA →"}
            </button>
          </form>
          <p className="mt-8 text-[11px] text-dim/60">
            Hold up — the invite code's on your beta invite. Lost it? The squad'll set you
            straight. First-come, free, and no real accounts yet — just a locked gym door and
            Deebo checking IDs.
          </p>
          <Link to="/" className="mt-6 text-xs font-bold tracking-widest text-dim hover:text-signal">
            ← BACK TO THE FRONT DOOR
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-night text-ink">
      {/* top bar */}
      <header className="sticky top-0 z-40 border-b border-edge/80 bg-night/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <div className="h-10 w-10 overflow-hidden rounded-full border-2 border-signal">
              <DeeboAvatar className="-ml-1 -mt-1 h-12 w-12" />
            </div>
            <div className="leading-none">
              <p className="font-display text-lg text-signal">ROBO DEEBO</p>
              <p className="text-[10px] font-bold tracking-[0.25em] text-dim">COPILOT · FREE BETA</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span
              className={`hidden rounded-full border px-3 py-1.5 text-[10px] font-bold tracking-widest sm:inline-block ${
                emailConnected
                  ? "border-lime-400/60 bg-lime-400/10 text-lime-400"
                  : "border-blaze/60 bg-blaze/10 text-blaze"
              }`}
            >
              {emailConnected ? "● EMAIL CONNECTED" : "○ EMAIL WAITING"}
            </span>
            <Link
              to="/"
              className="rounded-full border border-edge px-3 py-1.5 font-display text-[10px] tracking-wide text-dim transition-colors hover:border-signal hover:text-signal"
            >
              ← FRONT DOOR
            </Link>
          </div>
        </div>
      </header>

      {/* tab nav */}
      <nav className="border-b border-edge bg-panel/60">
        <div className="mx-auto flex max-w-6xl gap-2 overflow-x-auto px-4 py-3 sm:px-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {(
            [
              ["inbox", "📥 INBOX PATROL"],
              ["chat", "💬 DEEBO CHAT"],
              ["settings", "⚙️ SETTINGS"],
            ] as [Tab, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`shrink-0 rounded-full px-4 py-2 font-display text-xs tracking-wide transition-colors ${
                tab === id
                  ? "text-night"
                  : "border border-edge text-dim hover:border-signal hover:text-signal"
              }`}
              style={tab === id ? { backgroundColor: "var(--color-signal)" } : undefined}
            >
              {label}
            </button>
          ))}
          <span className="ml-auto hidden shrink-0 items-center gap-2 text-[10px] font-bold tracking-widest text-dim md:flex">
            DB: <span className={status?.dbConfigured ? "text-lime-400" : "text-blaze"}>{status?.dbConfigured ? "CONNECTED" : "WAITING"}</span>
            <span className="text-edge">·</span>
            EMAIL: <span className={emailConnected ? "text-lime-400" : "text-blaze"}>{emailConnected ? "CONNECTED" : "WAITING"}</span>
          </span>
        </div>
      </nav>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        {/* ============ INBOX PATROL ============ */}
        {tab === "inbox" && (
          <section>
            <p className="font-marker text-xl text-blaze sm:text-2xl">first period: mail call…</p>
            <h2 className="mt-1 font-display text-3xl text-ink sm:text-5xl">
              INBOX <span className="text-signal">PATROL</span>
            </h2>
            <p className="mt-2 max-w-2xl text-xs leading-relaxed text-dim sm:text-sm">
              Deebo's phishing watcher: heuristic scoring only — decision support, never certainty,
              and he never touches a real message until you say the word.
            </p>

            {!emailConnected ? (
              <div className="mt-8 overflow-hidden rounded-3xl border-2 border-dashed border-edge bg-panel/40 p-8 text-center sm:p-12">
                <div className="mx-auto h-20 w-20 overflow-hidden rounded-full border-2 border-edge opacity-80">
                  <DeeboAvatar className="h-full w-full" />
                </div>
                <p className="mt-5 font-display text-xl text-ink">
                  No inbox to watch yet — <span className="text-signal">plug me in</span> and I'll
                  start taking names.
                </p>
                <p className="mx-auto mt-2 max-w-md text-sm text-dim">
                  Connect your email in Settings (Gmail + app password is the default path;
                  Outlook/Graph plugs in later) and Inbox Patrol goes live.
                </p>
                <button
                  onClick={() => setTab("settings")}
                  className="mt-6 rounded-full px-6 py-3 font-display text-xs tracking-wide text-night transition-transform hover:scale-105 active:scale-95"
                  style={{ backgroundColor: "var(--color-signal)" }}
                >
                  CONNECT YOUR EMAIL →
                </button>
              </div>
            ) : (
              <div className="mt-8 rounded-3xl border-2 border-lime-400/40 bg-lime-400/5 p-6">
                <p className="font-display text-base text-lime-400">● INBOX WATCH CONNECTED</p>
                <p className="mt-1 text-xs leading-relaxed text-dim sm:text-sm">
                  Your email is connected, but no real messages have been scanned yet — live sync
                  is still being wired up. Until then, here's the engine showing its work
                  on sample data so you can see exactly how Inbox Patrol will score your mail.
                </p>
              </div>
            )}

            {/* sample data — clearly labeled */}
            <div className="mt-10">
              <div className="flex flex-wrap items-center gap-3">
                <h3 className="font-display text-xl text-ink">ENGINE DEMO — SAMPLE DATA</h3>
                <span className="rounded-full bg-blaze/10 px-3 py-1 text-[10px] font-bold tracking-[0.2em] text-blaze ring-1 ring-blaze/50">
                  SAMPLE DATA · NOT YOUR REAL INBOX
                </span>
              </div>
              <p className="mt-1 text-[11px] text-dim/70">
                Demo messages scored by the real phishing engine on this page — nothing here is real
                mail, nothing was fetched from any account.
              </p>

              <div className="mt-5 space-y-4">
                {scores.map(({ email, result }) => (
                  <EmailCard
                    key={email.id}
                    email={email}
                    result={result}
                    intent={intents[email.id]}
                    onIntent={(v) => markIntent(email.id, v)}
                  />
                ))}
              </div>
            </div>
          </section>
        )}

        {/* ============ DEEBO CHAT ============ */}
        {tab === "chat" && (
          <section>
            <p className="font-marker text-xl text-blaze sm:text-2xl">his office hours…</p>
            <h2 className="mt-1 font-display text-3xl text-ink sm:text-5xl">
              DEEBO'S <span className="text-signal">DESK</span>
            </h2>
            <p className="mt-2 max-w-2xl text-xs leading-relaxed text-dim sm:text-sm">
              Same Deebo, new office. Ask him "what's in my inbox" and he'll answer from the live
              connection state — honestly, always.
            </p>
            <div className="mt-6 h-[560px]">
              <DeeboChat open inline onOpenChange={() => {}} dashboardReply={dashboardReply} />
            </div>
          </section>
        )}

        {/* ============ SETTINGS ============ */}
        {tab === "settings" && (
          <section>
            <p className="font-marker text-xl text-blaze sm:text-2xl">the locker room…</p>
            <h2 className="mt-1 font-display text-3xl text-ink sm:text-5xl">
              <span className="text-signal">SETTINGS</span> & STATUS
            </h2>

            {/* env status */}
            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              <StatusTile
                label="DATABASE"
                ok={!!status?.dbConfigured}
                okText="CONNECTED"
                waitText="WAITING FOR SETUP"
                note={
                  status?.dbConfigured
                    ? "Settings persist to Postgres."
                    : "Owner is wiring up the database — until then, settings save locally in this browser."
                }
              />
              <StatusTile
                label="EMAIL WATCH"
                ok={emailConnected}
                okText="CONNECTED"
                waitText="WAITING"
                note={
                  emailConnected
                    ? "Connection saved — live sync is being wired up."
                    : "No email connected yet — save one below and Deebo's standing by."
                }
              />
              <StatusTile
                label="SECURE STORAGE"
                ok={!!status?.tigerConfigured}
                okText="READY"
                waitText="WAITING FOR SETUP"
                note={
                  status?.tigerConfigured
                    ? "Database keys are in — your data will persist safely."
                    : "Database keys are on the way — settings save locally in this browser until they arrive."
                }
              />
            </div>

            {/* connect email form */}
            <div className="mt-6 rounded-3xl border-2 border-edge bg-panel p-6 sm:p-8">
              <h3 className="font-display text-xl text-ink">CONNECT YOUR EMAIL</h3>
              <p className="mt-1 text-xs leading-relaxed text-dim">
                Deebo watches a mailbox by reading it only — no sends, no deletes, no moves until
                you approve an action (approvals are still being built). Gmail with an app
                password is the default path; Outlook support is on the way.
                IMAP hosts are read-only on purpose.
              </p>
              <form onSubmit={submitSettings} className="mt-6 grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="text-[10px] font-bold tracking-[0.25em] text-dim">PROVIDER</span>
                  <select
                    value={form.provider}
                    onChange={(e) => setForm((f) => ({ ...f, provider: e.target.value }))}
                    className="mt-1.5 h-12 w-full rounded-xl border border-edge bg-night px-3.5 text-sm text-ink focus:border-signal focus:outline-none"
                  >
                    <option value="gmail">Gmail (IMAP + app password)</option>
                    <option value="outlook">Outlook / Microsoft 365 (on the way)</option>
                    <option value="other">Other IMAP</option>
                  </select>
                </label>
                <label className="block">
                  <span className="text-[10px] font-bold tracking-[0.25em] text-dim">EMAIL ADDRESS</span>
                  <input
                    type="email"
                    required
                    value={form.email}
                    onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                    placeholder="you@example.com"
                    className="mt-1.5 h-12 w-full rounded-xl border border-edge bg-night px-3.5 text-sm text-ink placeholder:text-dim/40 focus:border-signal focus:outline-none"
                  />
                </label>
                <label className="block sm:col-span-2">
                  <span className="text-[10px] font-bold tracking-[0.25em] text-dim">APP PASSWORD</span>
                  <input
                    type="password"
                    value={form.appPassword}
                    onChange={(e) => setForm((f) => ({ ...f, appPassword: e.target.value }))}
                    placeholder={savedConn?.hasPassword ? "•••••••• (saved — leave blank to keep it)" : "16-char app password (Gmail: Google Account → Security → App passwords)"}
                    className="mt-1.5 h-12 w-full rounded-xl border border-edge bg-night px-3.5 text-sm text-ink placeholder:text-dim/40 focus:border-signal focus:outline-none"
                  />
                </label>
                <div className="flex flex-wrap items-center gap-4 sm:col-span-2">
                  <button
                    type="submit"
                    className="rounded-full px-6 py-3 font-display text-xs tracking-wide text-night transition-transform hover:scale-105 active:scale-95"
                    style={{ backgroundColor: "var(--color-signal)" }}
                  >
                    SAVE EMAIL CONNECTION
                  </button>
                  {status?.emailConfigured && (
                    <span className="text-[11px] text-lime-400">
                      Gmail watch runs with the account + app password you save here.
                    </span>
                  )}
                </div>
              </form>
              {saveNote && (
                <p className="mt-4 rounded-xl border border-lime-400/40 bg-lime-400/10 p-3 text-xs leading-relaxed text-lime-300">
                  {saveNote}
                </p>
              )}
              {saveErr && (
                <p className="mt-4 rounded-xl border border-blaze/50 bg-blaze/10 p-3 text-xs text-blaze">
                  {saveErr}
                </p>
              )}
              {savedConn?.mode === "local" && (
                <p className="mt-3 text-[11px] text-dim/80">
                  ⚠ Temporary local save — this connection lives in this browser only, until the
                  database connects. Full storage activates once it does.
                </p>
              )}
            </div>

            {/* about */}
            <div className="mt-6 rounded-3xl border border-edge bg-night/40 p-6">
              <h3 className="font-display text-base text-ink">ABOUT THIS BETA</h3>
              <ul className="mt-3 space-y-1.5 text-xs leading-relaxed text-dim sm:text-sm">
                <li>• <span className="font-bold text-ink">Live now:</span> the scoring engine, kick-the-tires demo, and Deebo's attitude. All client-side, all honest.</li>
                <li>• <span className="font-bold text-ink">Pending:</span> real email sync, the approval loop that actually acts, and real accounts to replace the invite gate.</li>
                <li>• <span className="font-bold text-blaze">Straight up:</span> nothing here guards a live inbox yet, and the phishing engine is heuristic decision-support — it flags likely phishing, never claims certainty.</li>
              </ul>
            </div>
          </section>
        )}
      </main>

      <footer className="border-t-2 border-edge bg-night px-4 py-8 text-center text-[11px] text-dim/60">
        Robo Deebo Copilot · invite-gated free beta · nothing here guards a live inbox yet — that's the
        point of the beta. Real protection ships when the squad suits up.
      </footer>
    </div>
  );
}

/* ---------------- small pieces ---------------- */

function StatusTile({ label, ok, okText, waitText, note }: { label: string; ok: boolean; okText: string; waitText: string; note: string }) {
  return (
    <div className={`rounded-2xl border-2 p-4 ${ok ? "border-lime-400/50 bg-lime-400/5" : "border-blaze/40 bg-blaze/5"}`}>
      <p className="text-[10px] font-bold tracking-[0.25em] text-dim">{label}</p>
      <p className={`mt-1 font-display text-sm ${ok ? "text-lime-400" : "text-blaze"}`}>
        {ok ? okText : waitText}
      </p>
      <p className="mt-2 text-[11px] leading-relaxed text-dim">{note}</p>
    </div>
  );
}

function EmailCard({
  email,
  result,
  intent,
  onIntent,
}: {
  email: ParsedEmail;
  result: ScoreResult;
  intent?: Intent;
  onIntent: (v: Intent) => void;
}) {
  const [showElite, setShowElite] = useState(false);
  return (
    <article className="overflow-hidden rounded-2xl border-2 border-edge bg-panel">
      <div className="grid gap-3 p-4 sm:grid-cols-[1fr_auto] sm:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="rounded-full px-2.5 py-0.5 text-[10px] font-bold tracking-widest text-night"
              style={{ backgroundColor: bandColor(result.band) }}
            >
              {result.band.toUpperCase()} · {result.score}
            </span>
            <span className="text-[10px] font-bold tracking-[0.2em] text-dim/70">{email.date}</span>
            {email.sample && (
              <span className="rounded-full border border-blaze/50 bg-blaze/10 px-2 py-0.5 text-[9px] font-bold tracking-widest text-blaze">
                SAMPLE
              </span>
            )}
          </div>
          <p className="mt-2 truncate text-sm font-semibold text-ink" title={email.from}>
            {email.from}
          </p>
          <p className="truncate text-xs text-dim" title={email.subject}>
            {email.subject}
          </p>
          <p className="mt-1.5 text-xs leading-relaxed text-dim">{result.explanation}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <button
            onClick={() => onIntent("approve")}
            disabled={!!intent}
            className={`rounded-xl border-2 px-3.5 py-2 font-display text-[10px] tracking-wide transition-colors ${
              intent === "approve"
                ? "border-lime-400 bg-lime-400/15 text-lime-400"
                : "border-signal text-signal hover:bg-signal hover:text-night disabled:opacity-40"
            }`}
          >
            {intent === "approve" ? "✓ APPROVED" : "APPROVE & ACT"}
          </button>
          <button
            onClick={() => onIntent("dismiss")}
            disabled={!!intent}
            className={`rounded-xl border-2 px-3.5 py-2 font-display text-[10px] tracking-wide transition-colors ${
              intent === "dismiss"
                ? "border-blaze bg-blaze/15 text-blaze"
                : "border-edge text-dim hover:border-blaze hover:text-blaze disabled:opacity-40"
            }`}
          >
            {intent === "dismiss" ? "✕ DISMISSED" : "DISMISS"}
          </button>
          <button
            onClick={() => setShowElite((s) => !s)}
            className="rounded-xl border border-edge px-3.5 py-2 font-display text-[10px] tracking-wide text-dim transition-colors hover:border-signal hover:text-signal"
          >
            {showElite ? "ELITE ▲" : "ELITE ▼"}
          </button>
        </div>
      </div>
      {intent && (
        <p className="border-t border-edge bg-night/60 px-4 py-2 text-[11px] text-dim">
          Intent marked: <span className="font-bold text-ink">{intent.toUpperCase()}</span> — queued for
          Deebo's review before anything happens. <span className="text-blaze">Nothing sent, nothing deleted — this UI only notes your intent.</span>
        </p>
      )}
      {showElite && (
        <pre className="whitespace-pre-line border-t border-edge bg-night/80 px-4 py-3 text-[11px] leading-relaxed text-dim">
          {eliteAssessment(email)}
        </pre>
      )}
    </article>
  );
}
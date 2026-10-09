import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { DeeboAvatar } from "~/components/DeeboAvatar";
import { DeeboChat } from "~/components/DeeboChat";
import {
  getSystemStatus,
  saveConnection,
  loadConnection,
  triggerSync,
  listScannedEmails,
  approveAndAct,
  dismissEmail,
  whoami,
  login,
  register,
  logout,
  createInvite,
  listInvites,
  changePassword,
  type SystemStatus,
  type ConnectionLoaded,
  type AccountView,
} from "~/lib/server";
import {
  SAMPLE_EMAILS,
  scoreEmail,
  eliteAssessment,
  bandColor,
  type ParsedEmail,
  type ScoreResult,
  type RiskBand,
} from "~/lib/phishing";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Robo Deebo — Copilot Dashboard · Free Beta" },
      {
        name: "description",
        content:
          "Robo Deebo's protection-copilot dashboard. Invite-gated free beta: Deebo watches your real inbox with the phishing engine, flags suspicious mail, proposes an action — and acts only on your explicit two-step approval. Every action is audit-logged.",
      },
    ],
  }),
  component: Dashboard,
});

const BETA_KEY = "deebo.beta.v1";
const SETTINGS_KEY = "deebo.settings.v1";
const FALLBACK_BETA = "DEEBO-BETA-2026";

type Tab = "inbox" | "chat" | "settings";

/** JSON-safe shape of a scanned real email as returned by listScannedEmails. */
interface LiveEmail {
  id: number;
  message_id: string;
  imap_uid: number | null;
  subject: string;
  sender: string;
  date: string;
  body_snippet: string;
  score: number;
  band: string;
  verdict: string;
  elite: string;
  explanation: string;
  status: string;
  scanned_at: string;
  action: ActionRow | null;
  links: LinkRow[];
}
interface LinkRow {
  id: number;
  url: string;
  final_url: string;
  host: string;
  shortener: number;
  shortener_hops: number;
  heuristic_verdict: string;
  heuristic_reason: string;
  gsb_verdict: string;
  gsb_source: string;
  combined: string; // safe | suspicious | dangerous
  combined_reason: string;
  checked_at: string;
}
interface ActionRow {
  id: number;
  email_id: number;
  kind: string;
  status: string;
  executed_at: string;
  result: string;
  error: string;
  created_at: string;
}
interface LatestAction extends ActionRow {
  subject: string;
}
interface SyncMeta {
  last_sync_at: string | null;
  last_sync_ok: number;
  last_error: string | null;
  message_count: number;
}
interface ScannedInbox {
  emails: LiveEmail[];
  sync: SyncMeta | null;
  latestActions: LatestAction[];
  executedTotal: number;
}

interface SavedConn {
  provider: string;
  email: string;
  hasPassword: boolean;
  mode: "db" | "local";
}
interface InviteView {
  code: string;
  uses_total: number;
  uses_used: number;
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

function fmtWhen(iso: string | null | undefined): string {
  if (!iso) return "never";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function kindLabel(kind: string): string {
  return kind === "move-to-spam" ? "MOVE TO SPAM" : kind === "dismiss" ? "DISMISS" : kind.toUpperCase();
}
function hostOfLink(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    const m = url.match(/^[a-z][a-z0-9+.-]*:\/\/([^/]+)/i);
    return m ? m[1] : url.slice(0, 48);
  }
}

function Dashboard() {
  const [gate, setGate] = useState<"loading" | "locked" | "open">("loading");
  const [me, setMe] = useState<AccountView | null>(null);
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [tab, setTab] = useState<Tab>("inbox");

  /* ---------------- auth gate ---------------- */
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [aHandle, setAHandle] = useState("");
  const [aName, setAName] = useState("");
  const [aPassword, setAPassword] = useState("");
  const [aInvite, setAInvite] = useState("");
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
      let u: AccountView | null = null;
      try {
        u = await whoami();
      } catch {
        /* treat as anonymous */
      }
      if (cancelled) return;
      setStatus(s);
      setMe(u);
      setGate(u ? "open" : "locked");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const submitAuth = async (e: FormEvent) => {
    e.preventDefault();
    if (checking) return;
    setChecking(true);
    setGateErr(null);
    try {
      const res =
        authMode === "login"
          ? await login({ data: { handle: aHandle, password: aPassword } })
          : await register({ data: { handle: aHandle, name: aName, password: aPassword, inviteCode: aInvite } });
      if (res.ok && res.account) {
        setMe(res.account);
        setGate("open");
      } else {
        setGateErr(res.error || "That didn't work — try again.");
      }
    } catch {
      setGateErr("Couldn't reach the server right now — try again in a moment.");
    } finally {
      setChecking(false);
    }
  };

  const doLogout = async () => {
    try {
      await logout();
    } catch {
      /* even on network failure we drop the local session view */
    }
    setMe(null);
    setGate("locked");
    setTab("inbox");
  };
  const isOwner = me?.role === "owner";

  /* ---------------- account section ---------------- */
  const [pwCurrent, setPwCurrent] = useState("");
  const [pwNext, setPwNext] = useState("");
  const [pwMsg, setPwMsg] = useState<string | null>(null);
  const [acctMsg, setAcctMsg] = useState<string | null>(null);
  const [invites, setInvites] = useState<InviteView[] | null>(null);
  const [freshInvite, setFreshInvite] = useState<string | null>(null);
  const refreshInvites = useCallback(async () => {
    try {
      const r = await listInvites();
      if (r.ok) {
        setInvites(r.invites.map((i) => ({ code: i.code, uses_total: i.uses_total, uses_used: i.uses_used })));
      }
    } catch {
      /* leave list as-is */
    }
  }, []);
  useEffect(() => {
    if (gate === "open" && isOwner) refreshInvites();
  }, [gate, isOwner, refreshInvites]);
  const doChangePw = async (e: FormEvent) => {
    e.preventDefault();
    setPwMsg(null);
    try {
      const r = await changePassword({ data: { current: pwCurrent, next: pwNext } });
      setPwMsg(r.ok ? "Password updated. Anything else I can school you on?" : r.error || "Couldn't update.");
      if (r.ok) {
        setPwCurrent("");
        setPwNext("");
      }
    } catch {
      setPwMsg("Couldn't reach the server — try again in a moment.");
    }
  };
  const doMintInvite = async () => {
    setAcctMsg(null);
    try {
      const r = await createInvite({ data: { usesTotal: 1, expiresInDays: 30 } });
      if (r.ok && r.invite) {
        setFreshInvite(r.invite);
        await refreshInvites();
      } else {
        setAcctMsg(r.error || "Couldn't mint an invite right now.");
      }
    } catch {
      setAcctMsg("Couldn't reach the server — try again in a moment.");
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
        setForm((f) => ({ ...f, provider: local.provider ?? "gmail", email: local.email ?? "" }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [gate]);

  const emailConnected = !!(
    status?.emailConfigured || (status?.emailWatch?.connected ?? false) || (savedConn?.email && savedConn.hasPassword)
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

  /* ---------------- live email watch state ---------------- */
  const [inbox, setInbox] = useState<ScannedInbox | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  const refreshInbox = useCallback(async (afterSync?: string) => {
    try {
      const data = await listScannedEmails();
      setInbox(data);
      if (afterSync) setSyncMsg(afterSync);
    } catch {
      setSyncMsg("Couldn't reach the patrol server right now — try again in a moment.");
    }
  }, []);

  useEffect(() => {
    if (gate !== "open") return;
    refreshInbox();
  }, [gate, refreshInbox]);

  const doSync = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    setSyncMsg(null);
    try {
      const res = await triggerSync();
      if (res.ok) {
        await refreshInbox(`Patrol refreshed — ${res.stored} message${res.stored === 1 ? "" : "s"} scanned in ${(res.durationMs / 1000).toFixed(1)}s.`);
      } else {
        setSyncMsg(res.error || "Sync failed — unknown reason.");
        await refreshInbox();
      }
    } catch {
      setSyncMsg("Sync request failed on the network — try again.");
      await refreshInbox();
    } finally {
      setSyncing(false);
    }
  }, [syncing, refreshInbox]);

  const liveEmails = inbox?.emails ?? [];
  const latestActions = inbox?.latestActions ?? [];
  const syncMeta = inbox?.sync ?? null;
  const watchFailed = syncMeta && syncMeta.last_sync_ok === 0 && !!syncMeta.last_error;

  const liveCounts = useMemo(() => {
    const c = { safe: 0, suspect: 0, phish: 0, total: liveEmails.length };
    for (const e of liveEmails) {
      if (e.verdict === "phish") c.phish++;
      else if (e.verdict === "suspect") c.suspect++;
      else c.safe++;
    }
    return c;
  }, [liveEmails]);

  const topRisk = useMemo(() => {
    if (!liveEmails.length) return null;
    let top: LiveEmail | null = null;
    for (const e of liveEmails) {
      if (!top || e.score > top.score) top = e;
    }
    return top;
  }, [liveEmails]);

  const actionCounts = useMemo(() => {
    const c = { acted: 0, dismissed: 0, failed: 0, pending: 0 };
    for (const e of liveEmails) {
      if (e.status === "acted") c.acted++;
      else if (e.status === "dismissed") c.dismissed++;
      else if (e.status === "failed") c.failed++;
      else c.pending++;
    }
    return c;
  }, [liveEmails]);

  /* ---------------- scored samples (deterministic, client-side) ---------------- */
  const scores = useMemo(
    () =>
      SAMPLE_EMAILS.map((email) => ({ email, result: scoreEmail(email) })).sort(
        (a, b) => b.result.score - a.result.score
      ),
    []
  );

  /* ---------------- Deebo narration feed (post-action stories) ---------------- */
  const [tales, setTales] = useState<string[]>([]);
  const tellDeebo = useCallback((n: string) => setTales((t) => [...t, n]), []);

  /* ---------------- dashboard-aware chat hook ---------------- */
  const dashboardReply = useCallback(
    (raw: string): string | null => {
      const t = raw.toLowerCase();
      const aboutMail =
        ["inbox", "email", "mail", "message", "phish"].some((k) => t.includes(k)) &&
        ["what", "how", "any", "risk", "watch", "status", "scan", "count", "score", "patrol"].some((k) => t.includes(k));
      const asksActions =
        ["moved", "move", "action", "acted", "log", "caught", "catch", "happen", "last moves", "history", "record", "tale", "what did you", "what did deebo"].some(
          (k) => t.includes(k)
        );

      if (asksActions) {
        const stopWords = new Set([
          "what", "happened", "did", "deebo", "happen", "last", "moves", "move", "moved", "action",
          "actions", "act", "acted", "log", "the", "with", "about", "email", "message", "inbox",
          "catch", "caught", "you", "your", "that", "this", "tell", "me", "any", "know", "moves",
        ]);
        const words = t.split(/\W+/).filter((w) => w.length >= 4 && !stopWords.has(w));
        const matched = liveEmails.find(
          (e) => words.some((w) => e.subject.toLowerCase().includes(w)) || words.some((w) => e.sender.toLowerCase().includes(w))
        );
        if (matched) {
          const statusLine =
            matched.status === "acted"
              ? `MOVED TO SPAM${matched.action ? ` — ${matched.action.result}` : ""}.`
              : matched.status === "dismissed"
                ? "DISMISSED — you said it was fine, I left it alone."
                : matched.status === "failed"
                  ? `FAILED — ${matched.action?.error ?? "see the action log"}. Left in place, your call next.`
                  : `still PENDING — flagged ${matched.band}. Approve & act or dismiss it on Inbox Patrol.`;
          return `"${matched.subject.slice(0, 80)}" from ${matched.sender.slice(0, 40)}: ${statusLine}`;
        }
        if (latestActions.length === 0) {
          return `The ledger's empty so far. I flag — you call — I act only on your word. Every move lands in the ACTION LOG. Say the word and I'll start taking names: hit APPROVE & ACT on Inbox Patrol.`;
        }
        const head = `Last moves — ${actionCounts.acted} to spam, ${actionCounts.dismissed} dismissed, ${actionCounts.failed} failed, ${actionCounts.pending} still pending.`;
        const lines = latestActions.slice(0, 3).map(
          (a) =>
            `• ${kindLabel(a.kind)} → ${a.status.toUpperCase()} — "${a.subject.slice(0, 56)}" (${fmtWhen(a.executed_at)})${a.error ? ` — ${a.error.slice(0, 80)}` : ""}`
        );
        return `${head}\n${lines.join("\n")}\nFull log is on Inbox Patrol. Never acted without your word — that's the whole rule.`;
      }

      const asksLinks =
        ["link", "links", "dangerous", "unsafe", "suspicious", "bad host", "phish link", "scam link", "click"].some(
          (k) => t.includes(k)
        ) &&
        ["which", "what", "any", "where", "link", "links", "dangerous", "unsafe", "suspicious", "safe", "click", "host", "check"].some(
          (k) => t.includes(k)
        );
      if (asksLinks) {
        const flagged = liveEmails.flatMap((e) =>
          (e.links ?? [])
            .filter((l) => l.combined === "suspicious" || l.combined === "dangerous")
            .map((l) => ({ e, l }))
        );
        if (flagged.length) {
          const lines = flagged.slice(0, 5).map(
            ({ e, l }) =>
              `• "${e.subject.slice(0, 56)}" → ${l.host || hostOfLink(l.final_url || l.url)}: ${l.combined.toUpperCase()} — ${l.combined_reason}`
          );
          const more = flagged.length > 5 ? `\n…and ${flagged.length - 5} more on Inbox Patrol.` : "";
          return `Yeah, I got eyes on ${flagged.length} sketchy link${flagged.length === 1 ? "" : "s"}:\n${lines.join("\n")}${more}\nDon't click. Don't even hover. I flag, you call — but my vote's stay clear.`;
        }
        const anyLinks = liveEmails.some((e) => (e.links ?? []).length > 0);
        if (anyLinks)
          return "Checked every link on the bench — nothing dangerous, nothing even suspicious. Clean. Verdicts are built-in analysis (Google Safe Browsing isn't connected yet), straight talk.";
        return "Nothing flagged and nothing to flag — no dangerous links on the bench right now. If a fresh sync brings links in, I'll check every one and tell you straight.";
      }
      if (!aboutMail) return null;
      if (liveEmails.length) {
        const topMsg = topRisk
          ? `${topRisk.score}/100 ${topRisk.band} — "${topRisk.subject.slice(0, 64)}"`
          : "no messages on the bench yet";
        return `Patrol's LIVE and I'm watching your real inbox. Right now: ${liveEmails.length} scanned · ${liveCounts.phish} phish · ${liveCounts.suspect} suspect · ${liveCounts.safe} safe. Top risk: ${topMsg}. Heuristic scoring plus your call: I flag and propose, you approve — I move to spam only on your two-step word. Every move's logged. Last sync: ${fmtWhen(syncMeta?.last_sync_at ?? null)}.`;
      }
      if (emailConnected && watchFailed)
        return `I'm connected to your email, but the last sync didn't land: ${syncMeta?.last_error ?? "unknown reason"}. Try the SYNC NOW button on Inbox Patrol.`;
      if (emailConnected)
        return "Email's connected and the watcher's armed — but no messages scanned yet. Hit SYNC NOW on Inbox Patrol and I'll start taking names.";
      return "No inbox to watch yet — plug me in and I'll start taking names. The owner's Gmail is already wired server-side; head to Inbox Patrol to sync it.";
    },
    [liveEmails, liveCounts, topRisk, syncMeta, emailConnected, watchFailed, latestActions, actionCounts]
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
        <div className="relative mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-6 py-14 text-center">
          <div className="glow-float h-20 w-20 overflow-hidden rounded-full border-4 border-signal">
            <DeeboAvatar className="h-full w-full" />
          </div>
          <p className="mt-5 font-marker text-2xl text-blaze">hold up. who's this?</p>
          <h1 className="mt-1 font-display text-4xl text-ink sm:text-5xl">
            COPILOT <span className="text-signal">ACCOUNT</span>
          </h1>
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-dim">
            Log in with your account — or enter an invite to create one. The beta is invite-only,
            free, and honest: no paid accounts, no tricks.
          </p>
          <div className="mt-6 flex w-full gap-2 rounded-full border-2 border-edge bg-panel-2 p-1">
            {(["login", "signup"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setAuthMode(m);
                  setGateErr(null);
                }}
                className={`flex-1 rounded-full py-2 font-display text-xs tracking-wide transition-colors ${
                  authMode === m ? "text-night" : "text-dim hover:text-signal"
                }`}
                style={authMode === m ? { backgroundColor: "var(--color-signal)" } : undefined}
              >
                {m === "login" ? "LOG IN" : "CREATE ACCOUNT"}
              </button>
            ))}
          </div>
          <form onSubmit={submitAuth} className="mt-5 w-full space-y-3">
            {authMode === "signup" && (
              <input
                value={aName}
                onChange={(e) => setAName(e.target.value)}
                placeholder="NAME (as it goes in the yearbook)"
                aria-label="Name"
                className="h-12 w-full rounded-2xl border-2 border-edge bg-panel-2 px-4 text-sm text-ink placeholder:text-dim/40 focus:border-signal focus:outline-none"
              />
            )}
            <input
              value={aHandle}
              onChange={(e) => setAHandle(e.target.value)}
              placeholder="HANDLE (3–24 letters, numbers, . _ -)"
              aria-label="Handle"
              className="h-12 w-full rounded-2xl border-2 border-edge bg-panel-2 px-4 text-sm text-ink placeholder:text-dim/40 focus:border-signal focus:outline-none"
            />
            <input
              type="password"
              value={aPassword}
              onChange={(e) => setAPassword(e.target.value)}
              placeholder="PASSWORD (at least 8 characters)"
              aria-label="Password"
              className="h-12 w-full rounded-2xl border-2 border-edge bg-panel-2 px-4 text-sm text-ink placeholder:text-dim/40 focus:border-signal focus:outline-none"
            />
            {authMode === "signup" && (
              <input
                value={aInvite}
                onChange={(e) => setAInvite(e.target.value)}
                placeholder="INVITE CODE"
                aria-label="Invite code"
                className="h-12 w-full rounded-2xl border-2 border-edge bg-panel-2 px-4 text-center font-display text-sm tracking-[0.2em] text-ink placeholder:text-dim/40 focus:border-signal focus:outline-none"
              />
            )}
            {gateErr && <p className="font-marker text-sm text-blaze">{gateErr}</p>}
            <button
              type="submit"
              disabled={checking}
              className="mt-1 w-full rounded-2xl py-4 font-display text-sm tracking-wide text-night transition-transform hover:scale-[1.02] active:scale-95 disabled:opacity-60"
              style={{ backgroundColor: "var(--color-signal)" }}
            >
              {checking ? "CHECKING ID…" : authMode === "login" ? "LOG IN →" : "CREATE ACCOUNT →"}
            </button>
          </form>
          <p className="mt-6 text-[11px] leading-relaxed text-dim/60">
            First squad member? It takes an actual invite. No real accounts to buy — just a locked
            gym door and Deebo checking IDs. Passwords are hashed with scrypt; your session cookie
            is signed and expires in 30 days.
          </p>
          <Link to="/" className="mt-5 text-xs font-bold tracking-widest text-dim hover:text-signal">
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
            {me && (
              <span className="hidden items-center gap-1.5 rounded-full border border-signal/40 bg-signal/10 px-3 py-1.5 text-[10px] font-bold tracking-widest text-signal sm:inline-flex">
                {me.handle.toUpperCase()}
                <span className="text-edge">·</span>
                {isOwner ? "OWNER" : "BETA"}
                <button
                  onClick={doLogout}
                  className="ml-1 underline decoration-signal/50 underline-offset-2 hover:text-blaze"
                  aria-label="Log out"
                >
                  LOG OUT
                </button>
              </span>
            )}
            <span
              className={`hidden rounded-full border px-3 py-1.5 text-[10px] font-bold tracking-widest sm:inline-block ${
                liveEmails.length
                  ? "border-lime-400/60 bg-lime-400/10 text-lime-400"
                  : emailConnected
                    ? "border-signal/60 bg-signal/10 text-signal"
                    : "border-blaze/60 bg-blaze/10 text-blaze"
              }`}
            >
              {liveEmails.length ? `● WATCH LIVE · ${liveEmails.length} SCANNED` : emailConnected ? "● EMAIL CONNECTED" : "○ EMAIL WAITING"}
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
            WATCH:{" "}
            <span className={liveEmails.length ? "text-lime-400" : emailConnected ? "text-signal" : "text-blaze"}>
              {liveEmails.length ? "LIVE" : emailConnected ? "CONNECTED" : "WAITING"}
            </span>
            <span className="text-edge">·</span>
            STORAGE:{" "}
            <span className={status?.storage.ok ? "text-lime-400" : "text-blaze"}>
              {status?.storage.ok ? "SQLITE OK" : "PROBLEM"}
            </span>
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
              Deebo's phishing watcher is live: it reads the last ~50 messages, scores them with
              the heuristic engine, and proposes an action on flagged mail. Read-only until you
              give the word — APPROVE & ACT moves one flagged message to Gmail's Spam, and every
              move (or failure) lands in Deebo's action log.
            </p>
            {inbox?.viewer === "member" && (
              <div className="mt-6 rounded-3xl border-2 border-dashed border-edge bg-panel/40 p-6 text-center sm:p-8">
                <p className="font-display text-lg text-ink">
                  This bench watches the <span className="text-signal">owner's mailbox</span> — yours comes later.
                </p>
                <p className="mx-auto mt-2 max-w-md text-sm text-dim">
                  You're in the beta as {me?.handle}. Deebo won't show you someone else's mail — when your own
                  connection lands, this bench lights up for you. Chat works, hood rules apply.
                </p>
              </div>
            )}

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
                  The owner's Gmail is wired server-side; once email connection lands in Settings,
                  Inbox Patrol syncs the real thing.
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
              <div
                className={`mt-8 rounded-3xl border-2 p-6 ${
                  watchFailed
                    ? "border-blaze/50 bg-blaze/5"
                    : liveEmails.length
                      ? "border-lime-400/40 bg-lime-400/5"
                      : "border-signal/50 bg-signal/5"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="font-display text-base text-lime-400">
                    {liveEmails.length
                      ? "● INBOX WATCH LIVE"
                      : watchFailed
                        ? "⚠ WATCH CONNECTED — LAST SYNC FAILED"
                        : "● WATCH CONNECTED — AWAITING FIRST SYNC"}
                  </p>
                  <button
                    onClick={doSync}
                    disabled={syncing}
                    className="rounded-full border border-signal px-4 py-2 font-display text-[10px] tracking-widest text-signal transition-colors hover:bg-signal hover:text-night disabled:opacity-50"
                  >
                    {syncing ? "SYNCING… (≤22s)" : "⟳ SYNC NOW"}
                  </button>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-dim sm:text-sm">
                  {liveEmails.length
                    ? `Last sync ${fmtWhen(syncMeta?.last_sync_at)} — ${liveCounts.total} messages on the bench: ${liveCounts.phish} phish, ${liveCounts.suspect} suspect, ${liveCounts.safe} safe. Deebo's acted ${inbox?.executedTotal ?? actionCounts.acted} time${(inbox?.executedTotal ?? actionCounts.acted) === 1 ? "" : "s"} on your word.`
                    : watchFailed
                      ? `Last sync failed (${fmtWhen(syncMeta?.last_sync_at)}): ${syncMeta?.last_error ?? "unknown reason"}. Fix the connection or hit SYNC NOW to retry — the site never breaks, the error just gets recorded.`
                      : "Connected and ready — hit SYNC NOW to scan the most recent ~50 messages. It takes a few seconds."}
                </p>
                {syncMsg && (
                  <p className="mt-2 rounded-xl border border-edge bg-night/60 px-3 py-2 text-[11px] text-ink">
                    {syncMsg}
                  </p>
                )}
              </div>
            )}

            {liveEmails.length > 0 ? (
              /* real scanned messages — live watch */
              <div className="mt-10">
                <div className="flex flex-wrap items-center gap-3">
                  <h3 className="font-display text-xl text-ink">YOUR INBOX — LIVE PATROL</h3>
                  <span className="rounded-full bg-lime-400/10 px-3 py-1 text-[10px] font-bold tracking-[0.2em] text-lime-400 ring-1 ring-lime-400/50">
                    REAL MESSAGES · APPROVAL-GATED
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-dim/70">
                  The most recent {liveEmails.length} messages from the mailbox, scored by the same
                  engine as the demo. Deebo proposes a move to spam for High/Medium flags — he
                  never acts without your two-step approval, and every action shows in the log.
                </p>
                <p className="mt-2 text-[10px] tracking-wide text-dim/60">
                  Link check:{" "}
                  {status?.gsbConfigured
                    ? "built-in analysis + Google Safe Browsing"
                    : "built-in analysis only — Google Safe Browsing not connected"}
                </p>
                <div className="mt-5 space-y-4">
                  {liveEmails.map((e) => (
                    <LiveEmailCard key={e.id} email={e} onChange={refreshInbox} onNarration={tellDeebo} />
                  ))}
                </div>
              </div>
            ) : (
              /* demo fallback — clearly labeled */
              <div className="mt-10">
                <div className="flex flex-wrap items-center gap-3">
                  <h3 className="font-display text-xl text-ink">ENGINE DEMO — SAMPLE DATA</h3>
                  <span className="rounded-full bg-blaze/10 px-3 py-1 text-[10px] font-bold tracking-[0.2em] text-blaze ring-1 ring-blaze/50">
                    DEMO · NOT YOUR REAL INBOX
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-dim/70">
                  Demo messages scored by the real phishing engine — used only until the live scan
                  fills the bench. Nothing here is real mail, so there's nothing to act on: demo
                  stays demo.
                </p>
                <div className="mt-5 space-y-4">
                  {scores.map(({ email, result }) => (
                    <EmailCard key={email.id} email={email} result={result} />
                  ))}
                </div>
              </div>
            )}

            {/* ACTION LOG — what Deebo actually did */}
            <div className="mt-10 rounded-3xl border-2 border-edge bg-panel p-6">
              <h3 className="font-display text-xl text-ink">
                DEEBO'S <span className="text-signal">ACTION LOG</span>
              </h3>
              <p className="mt-1 text-[11px] text-dim/70">
                Every move Deebo made (or tried) on your word — newest first. Nothing happens off
                this log; nothing happens without your approval.
              </p>
              {latestActions.length === 0 ? (
                <p className="mt-4 rounded-xl border border-dashed border-edge bg-night/50 px-4 py-3 text-xs text-dim">
                  No actions yet. Approve a flagged message and Deebo's first move lands here.
                </p>
              ) : (
                <ul className="mt-4 space-y-2">
                  {latestActions.map((a) => (
                    <li
                      key={a.id}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-edge bg-night/60 px-4 py-2.5 text-xs"
                    >
                      <span
                        className={`rounded-full px-2 py-0.5 text-[9px] font-bold tracking-widest ${
                          a.status === "executed"
                            ? "bg-lime-400/10 text-lime-400 ring-1 ring-lime-400/50"
                            : "bg-blaze/10 text-blaze ring-1 ring-blaze/50"
                        }`}
                      >
                        {kindLabel(a.kind)} · {a.status.toUpperCase()}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-semibold text-ink" title={a.subject}>
                        {a.subject}
                      </span>
                      <span className="text-[10px] text-dim">{fmtWhen(a.executed_at)}</span>
                      <span className={`w-full text-[11px] sm:w-auto ${a.status === "executed" ? "text-dim" : "text-blaze"}`}>
                        {a.status === "executed" ? a.result || "done" : a.error || "failed"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
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
              Same Deebo, new office. Ask him "what's in my inbox" or "what did you catch lately"
              and he'll answer from the live scan and the action log — honestly, always.
            </p>
            <div className="mt-6 h-[560px]">
              <DeeboChat open inline onOpenChange={() => {}} dashboardReply={dashboardReply} deeboEvents={tales} />
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
                waitText="LOCAL MODE"
                note={
                  status?.dbConfigured
                    ? "A real Postgres is wired — settings can persist there."
                    : "No usable Postgres yet (the beta decision is local storage). Mail scans and the action log persist to sqlite on this machine."
                }
              />
              <StatusTile
                label="EMAIL WATCH"
                ok={emailConnected}
                okText="CONNECTED"
                waitText="WAITING"
                note={
                  emailConnected
                    ? watchFailed
                      ? `Watch runs server-side. Last sync failed: ${syncMeta?.last_error ?? "unknown"} (${fmtWhen(syncMeta?.last_sync_at)}).`
                      : liveEmails.length
                        ? `Live — last sync ${fmtWhen(syncMeta?.last_sync_at)} · ${liveEmails.length} messages scanned.`
                        : "Connected — no scan yet. Hit SYNC NOW on Inbox Patrol."
                    : "No email connected yet — the owner's Gmail is wired server-side; this will flip green when it's in."
                }
              />
              <StatusTile
                label="SECURE STORAGE"
                ok={!!status?.storage.ok}
                okText="SQLITE OK"
                waitText="STORAGE PROBLEM"
                note={
                  status?.storage.ok
                    ? `Local sqlite database at ${status?.storage.path ?? "data/deebo.db"} — ${status?.storage.tables ?? 0} tables. Beta storage: no cloud DB.`
                    : "Local sqlite is unavailable — scans can't persist. Check the server log."
                }
              />
            </div>

            {/* account */}
            <div className="mt-6 rounded-3xl border-2 border-edge bg-panel p-6 sm:p-8">
              <h3 className="font-display text-xl text-ink">ACCOUNT</h3>
              <p className="mt-1 text-xs leading-relaxed text-dim">
                {me
                  ? `Signed in as ${me.name || me.handle} — @${me.handle}, ${
                      isOwner ? "owner (the door-holder of this beta)" : "beta squad member"
                    } · ID #${me.id}. `
                  : ""}
                Passwords are hashed with scrypt and a per-user salt before they touch the database.
                Your session cookie is httpOnly, signed, and expires after 30 days — logging out
                revokes it server-side.
              </p>
              {isOwner && (
                <div className="mt-4 rounded-2xl border border-signal/30 bg-signal/5 p-4">
                  <p className="font-display text-sm text-ink">MINT AN INVITE</p>
                  <p className="mt-1 text-xs text-dim">
                    Single-use, valid 30 days — hand it to someone you trust.
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      onClick={doMintInvite}
                      className="rounded-full bg-signal px-4 py-2 font-display text-xs tracking-wide text-night transition-transform hover:scale-105 active:scale-95"
                    >
                      MINT →
                    </button>
                    {freshInvite && (
                      <code className="rounded-lg border border-signal/40 bg-night px-3 py-1.5 font-mono text-sm tracking-widest text-signal">
                        {freshInvite}
                      </code>
                    )}
                  </div>
                  {acctMsg && <p className="mt-2 text-xs text-blaze">{acctMsg}</p>}
                  {invites && invites.length > 0 && (
                    <ul className="mt-3 space-y-1.5">
                      {invites.map((i) => (
                        <li key={i.code} className="flex items-center gap-2 font-mono text-xs text-dim">
                          <span className="tracking-widest">{i.code}</span>
                          <span className="text-[10px] text-dim/60">
                            USED {i.uses_used}/{i.uses_total}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              <form onSubmit={doChangePw} className="mt-4 grid gap-3 sm:grid-cols-3">
                <input
                  type="password"
                  value={pwCurrent}
                  onChange={(e) => setPwCurrent(e.target.value)}
                  placeholder="CURRENT PASSWORD"
                  aria-label="Current password"
                  className="h-11 rounded-xl border-2 border-edge bg-panel-2 px-3 text-sm text-ink placeholder:text-dim/40 focus:border-signal focus:outline-none"
                />
                <input
                  type="password"
                  value={pwNext}
                  onChange={(e) => setPwNext(e.target.value)}
                  placeholder="NEW PASSWORD (8+ chars)"
                  aria-label="New password"
                  className="h-11 rounded-xl border-2 border-edge bg-panel-2 px-3 text-sm text-ink placeholder:text-dim/40 focus:border-signal focus:outline-none"
                />
                <button
                  type="submit"
                  className="h-11 rounded-xl border-2 border-signal px-4 font-display text-xs tracking-wide text-signal transition-colors hover:bg-signal hover:text-night"
                >
                  CHANGE PASSWORD
                </button>
              </form>
              {pwMsg && <p className="mt-2 text-xs text-dim/80">{pwMsg}</p>}
              <div className="mt-5 flex items-center justify-between border-t border-edge pt-4">
                <p className="text-xs text-dim">Done for now?</p>
                <button
                  onClick={doLogout}
                  className="rounded-full border border-blaze/60 px-4 py-2 font-display text-xs tracking-wide text-blaze transition-colors hover:bg-blaze hover:text-night"
                >
                  LOG OUT
                </button>
              </div>
            </div>
            {/* connect email form */}
            <div className="mt-6 rounded-3xl border-2 border-edge bg-panel p-6 sm:p-8">
              <h3 className="font-display text-xl text-ink">CONNECT YOUR EMAIL</h3>
              <p className="mt-1 text-xs leading-relaxed text-dim">
                Deebo watches a mailbox read-only and only ever acts on flagged mail with your
                explicit approval (move-to-spam — never sends, never deletes). The watch already
                runs with the owner's Gmail account server-side; this form is for keeping your own
                connection info for when multi-account arrives. Gmail with an app password is the
                default path.
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
                      Gmail watch runs with the owner's account + app password server-side.
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
                  ⚠ Temporary local save — this connection lives in this browser only, until a real
                  database connects.
                </p>
              )}
            </div>

            {/* about */}
            <div className="mt-6 rounded-3xl border border-edge bg-night/40 p-6">
              <h3 className="font-display text-base text-ink">ABOUT THIS BETA</h3>
              <ul className="mt-3 space-y-1.5 text-xs leading-relaxed text-dim sm:text-sm">
                <li>• <span className="font-bold text-ink">Live now:</span> the real inbox watch (last ~50 messages, read-only IMAP scan), the scoring engine, and the approval loop — Deebo moves flagged mail to spam only on your two-step approval, and every action is audit-logged. Data persists to local sqlite (one file, dev and prod) — no cloud DB in the beta.</li>
                <li>• <span className="font-bold text-ink">Pending:</span> real accounts to replace the invite gate, multi-mailbox support, and the on-device protection engine (a later phase).</li>
                <li>• <span className="font-bold text-blaze">Straight up:</span> Deebo flags and proposes — he never acts without your word, and he never sends or deletes anything. The phishing engine is heuristic decision-support; it flags likely phishing, never claims certainty.</li>
              </ul>
            </div>
          </section>
        )}
      </main>

      <footer className="border-t-2 border-edge bg-night px-4 py-8 text-center text-[11px] text-dim/60">
        Robo Deebo Copilot · invite-gated free beta · the watch is real, and so is the rule: Deebo
        scans, flags, proposes, and acts only on your explicit approval — with every move logged.
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

/** Demo sample card — scored client-side by the real engine. Demo stays demo:
 *  no action buttons, because there's nothing real to move. */
function EmailCard({ email, result }: { email: ParsedEmail; result: ScoreResult }) {
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
            <span className="rounded-full border border-blaze/50 bg-blaze/10 px-2 py-0.5 text-[9px] font-bold tracking-widest text-blaze">
              DEMO
            </span>
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
          <span className="rounded-xl border border-edge px-3.5 py-2 font-display text-[10px] tracking-wide text-dim/70">
            DEMO — NO ACTION
          </span>
          <button
            onClick={() => setShowElite((s) => !s)}
            className="rounded-xl border border-edge px-3.5 py-2 font-display text-[10px] tracking-wide text-dim transition-colors hover:border-signal hover:text-signal"
          >
            {showElite ? "ELITE ▲" : "ELITE ▼"}
          </button>
        </div>
      </div>
      {showElite && (
        <pre className="whitespace-pre-line border-t border-edge bg-night/80 px-4 py-3 text-[11px] leading-relaxed text-dim">
          {eliteAssessment(email)}
        </pre>
      )}
    </article>
  );
}

/** Live scanned email card — two-step, explicit, server-executed actions. */
function LiveEmailCard({
  email,
  onChange,
  onNarration,
}: {
  email: LiveEmail;
  onChange: () => void;
  onNarration: (n: string) => void;
}) {
  const [showElite, setShowElite] = useState(false);
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState<null | "act" | "dismiss">(null);
  const [cardErr, setCardErr] = useState<string | null>(null);
  const band = email.band as RiskBand;
  const flaggable = email.status === "pending" && (band === "High" || band === "Medium");

  const act = async () => {
    if (!flaggable || busy) return;
    if (!armed) {
      setArmed(true); // first click arms; second click moves
      return;
    }
    setBusy("act");
    setCardErr(null);
    setArmed(false);
    try {
      const res = await approveAndAct({ data: { emailId: email.id } });
      onNarration(
        res.ok
          ? `Moved "${email.subject.slice(0, 64)}…" to spam — your word, my muscle. Logged.`
          : `Tried "${email.subject.slice(0, 64)}…" and hit a wall: ${res.error ?? "unknown"}. Message left in place.`
      );
      onChange();
    } catch {
      setCardErr("Couldn't reach Deebo's server — try again in a moment. Nothing was moved.");
    } finally {
      setBusy(null);
    }
  };

  const dismiss = async () => {
    if (!flaggable || busy) return;
    setBusy("dismiss");
    setCardErr(null);
    try {
      const res = await dismissEmail({ data: { emailId: email.id } });
      onNarration(
        res.ok
          ? `Dismissed "${email.subject.slice(0, 64)}…" — your call, it's none of my business. Logged.`
          : `Couldn't log a dismissal for "${email.subject.slice(0, 64)}…": ${res.error ?? "unknown"}.`
      );
      onChange();
    } catch {
      setCardErr("Couldn't reach Deebo's server — try again in a moment.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <article className="overflow-hidden rounded-2xl border-2 border-edge bg-panel">
      <div className="grid gap-3 p-4 sm:grid-cols-[1fr_auto] sm:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="rounded-full px-2.5 py-0.5 text-[10px] font-bold tracking-widest text-night"
              style={{ backgroundColor: bandColor(band) }}
            >
              {band.toUpperCase()} · {email.score}
            </span>
            <span className="text-[10px] font-bold tracking-[0.2em] text-dim/70">
              {fmtWhen(email.date)}
            </span>
            <span
              className={`rounded-full px-2 py-0.5 text-[9px] font-bold tracking-widest ${
                email.verdict === "phish"
                  ? "bg-blaze/15 text-blaze ring-1 ring-blaze/50"
                  : email.verdict === "suspect"
                    ? "bg-signal/15 text-signal ring-1 ring-signal/50"
                    : "bg-lime-400/10 text-lime-400 ring-1 ring-lime-400/40"
              }`}
            >
              {email.verdict.toUpperCase()}
            </span>
            <span className="rounded-full border border-lime-400/40 bg-lime-400/5 px-2 py-0.5 text-[9px] font-bold tracking-widest text-lime-300">
              REAL
            </span>
            {email.status !== "pending" && (
              <span
                className={`rounded-full px-2 py-0.5 text-[9px] font-bold tracking-widest ${
                  email.status === "acted"
                    ? "bg-lime-400/15 text-lime-400 ring-1 ring-lime-400/60"
                    : email.status === "dismissed"
                      ? "bg-dim/10 text-dim ring-1 ring-edge"
                      : "bg-blaze/15 text-blaze ring-1 ring-blaze/60"
                }`}
              >
                {email.status === "acted" ? "✓ MOVED TO SPAM" : email.status === "dismissed" ? "✕ DISMISSED" : "⚠ FAILED"}
              </span>
            )}
          </div>
          <p className="mt-2 truncate text-sm font-semibold text-ink" title={email.sender}>
            {email.sender}
          </p>
          <p className="truncate text-xs text-dim" title={email.subject}>
            {email.subject}
          </p>
          {email.body_snippet && (
            <p className="mt-1.5 line-clamp-2 text-[11px] leading-relaxed text-dim/70" title={email.body_snippet}>
              {email.body_snippet}
            </p>
          )}
          <p className="mt-1.5 text-xs leading-relaxed text-dim">{email.explanation}</p>
          {(band === "High" || band === "Medium") && (
            <div className="mt-3 rounded-xl border border-edge bg-night/40 px-3 py-2.5">
              <p className="text-[10px] font-bold tracking-[0.25em] text-dim">LINK PATROL</p>
              {email.links && email.links.length > 0 ? (
                <ul className="mt-2 space-y-2">
                  {email.links.map((lk) => {
                    const finalHost = lk.host || hostOfLink(lk.final_url || lk.url);
                    const v = lk.combined || "safe";
                    return (
                      <li key={lk.id} className="text-[11px] leading-snug">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          <span
                            className="min-w-0 max-w-[14rem] truncate font-mono text-dim"
                            title={lk.final_url || lk.url}
                          >
                            {finalHost}
                          </span>
                          {v === "safe" && (
                            <span className="rounded-full bg-lime-400/15 px-2 py-0.5 text-[9px] font-bold tracking-widest text-lime-400 ring-1 ring-lime-400/50">
                              SAFE
                            </span>
                          )}
                          {v === "suspicious" && (
                            <span className="rounded-full bg-amber-400/15 px-2 py-0.5 text-[9px] font-bold tracking-widest text-amber-400 ring-1 ring-amber-400/60">
                              SUSPICIOUS
                            </span>
                          )}
                          {v === "dangerous" && (
                            <span className="rounded-full bg-blaze/25 px-2 py-0.5 text-[9px] font-bold tracking-widest text-blaze ring-2 ring-blaze/70">
                              ☠ DANGEROUS
                            </span>
                          )}
                        </div>
                        {v === "dangerous" ? (
                          <p className="mt-0.5 font-marker text-[11px] text-blaze">
                            {lk.combined_reason} — don't click that, don't even hover.
                          </p>
                        ) : (
                          <p className="mt-0.5 text-dim/80">{lk.combined_reason}</p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="mt-1.5 text-[11px] text-dim/70">No links on file — the last sync found none (re-sync to double-check).</p>
              )}
            </div>
          )}
          {email.status === "pending" && flaggable && (
            <p className="mt-2 font-marker text-[11px] text-signal">
              Proposed: move to spam — Deebo acts only on your word.
            </p>
          )}
          {email.status === "pending" && band === "Low" && (
            <p className="mt-2 text-[11px] text-dim/70">Low risk — no action proposed.</p>
          )}
          {email.action && email.status !== "pending" && (
            <p className="mt-1.5 text-[11px] text-dim/80">
              Logged: {kindLabel(email.action.kind)} · {email.action.status.toUpperCase()} —{" "}
              <span className={email.action.status === "executed" ? "text-lime-300" : "text-blaze"}>
                {email.action.error || email.action.result}
              </span>{" "}
              · {fmtWhen(email.action.executed_at)}
            </p>
          )}
          {cardErr && <p className="mt-1.5 text-[11px] font-semibold text-blaze">{cardErr}</p>}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {flaggable ? (
            <>
              {armed ? (
                <>
                  <button
                    onClick={act}
                    disabled={!!busy}
                    className="rounded-xl border-2 border-blaze bg-blaze/15 px-3.5 py-2 font-display text-[10px] font-bold tracking-wide text-blaze transition-colors hover:bg-blaze hover:text-night disabled:opacity-50"
                  >
                    {busy === "act" ? "MOVING TO SPAM…" : "CONFIRM — MOVE TO SPAM"}
                  </button>
                  <button
                    onClick={() => setArmed(false)}
                    disabled={!!busy}
                    className="rounded-xl border border-edge px-3.5 py-2 font-display text-[10px] tracking-wide text-dim transition-colors hover:border-dim hover:text-ink disabled:opacity-50"
                  >
                    CANCEL
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={act}
                    disabled={!!busy}
                    className="rounded-xl border-2 border-signal px-3.5 py-2 font-display text-[10px] tracking-wide text-signal transition-colors hover:bg-signal hover:text-night disabled:opacity-50"
                  >
                    {busy === "act" ? "MOVING TO SPAM…" : busy === "dismiss" ? "HOLD UP…" : "APPROVE & ACT"}
                  </button>
                  <button
                    onClick={dismiss}
                    disabled={!!busy}
                    className="rounded-xl border-2 border-edge px-3.5 py-2 font-display text-[10px] tracking-wide text-dim transition-colors hover:border-blaze hover:text-blaze disabled:opacity-50"
                  >
                    {busy === "dismiss" ? "DISMISSING…" : "DISMISS"}
                  </button>
                </>
              )}
            </>
          ) : email.status === "failed" ? (
            <span className="rounded-xl border border-blaze/50 px-3.5 py-2 font-display text-[10px] tracking-wide text-blaze">
              LEFT IN PLACE — YOUR CALL
            </span>
          ) : null}
          <button
            onClick={() => setShowElite((s) => !s)}
            className="rounded-xl border border-edge px-3.5 py-2 font-display text-[10px] tracking-wide text-dim transition-colors hover:border-signal hover:text-signal"
          >
            {showElite ? "ELITE ▲" : "ELITE ▼"}
          </button>
        </div>
      </div>
      {armed && (
        <p className="border-t border-blaze/40 bg-blaze/5 px-4 py-2 text-[11px] text-blaze">
          ⚠ This moves the real message in your Gmail. Only Deebo's flagged mail. Your call —
          confirm and it's done, logged, and out of your inbox.
        </p>
      )}
      {showElite && (
        <pre className="whitespace-pre-line border-t border-edge bg-night/80 px-4 py-3 text-[11px] leading-relaxed text-dim">
          {email.elite || "ELITE assessment unavailable for this scan."}
        </pre>
      )}
    </article>
  );
}
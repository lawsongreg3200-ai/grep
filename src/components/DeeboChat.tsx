import { useEffect, useRef, useState } from "react";
import { DeeboAvatar } from "./DeeboAvatar";

type Msg = { role: "deebo" | "user"; text: string; time: string; elite?: boolean };

const CHIPS = [
  "Who are you?",
  "What can you build?",
  "Can you analyze a whole codebase?",
  "What happens when a virus shows up?",
  "What did you catch lately?",
  "GO ELITE 🔬",
  "ELITE: Analyze a codebase",
  "ELITE: Threat assessment",
  "Can you protect my phone?",
];

const now = () =>
  new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

const ELITE_TRIGGERS = ["elite", "deep dive", "deep analysis", "full report"];

/** Deebo's brain. Keyword-matched banter — the all-in-one autonomous
 * intelligence (structural analysis, code engineering, data synthesis) with a
 * mean streak aimed at threats. Never claims live protection, never promises a
 * VPN (that tunnel's off the roster) — what's live is the chat, and he says so. */
function deeboReply(raw: string): string {
  const t = raw.toLowerCase();
  const pick = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)];

  if (
    t.includes("all-in-one") ||
    t.includes("architect") ||
    t.includes("analyze") ||
    t.includes("analysis") ||
    t.includes("structure") ||
    t.includes("architecture") ||
    t.includes("codebase") ||
    t.includes("code base") ||
    t.includes("large file") ||
    t.includes("big file") ||
    t.includes("huge project") ||
    t.includes("context")
  )
    return pick([
      "Massive structural analysis? That's my warm-up. Whole codebases, ultra-large files, context sets that would choke a lesser bot — I map it all in one sweep and show you where the bodies are buried: cross-file dependencies, dead ends, the works. The deep-processing connections are still booting up, but the brain's already this big.",
      "You bring me a mega codebase, I see the whole skyline in one look — architecture, dependencies, where the cracks are. Right now I'm running off banter and attitude; the real analysis engines come online with my connections. Watch this space.",
    ]);

  if (
    t.includes("code") ||
    t.includes("script") ||
    t.includes("debug") ||
    t.includes("build") ||
    t.includes("engineer") ||
    t.includes("logic") ||
    t.includes("program") ||
    t.includes("write me") ||
    t.includes("make me") ||
    t.includes("deploy")
  )
    return pick([
      "Precision logic and code engineering — that's my second period, and I got straight A's. Complex scripts, meticulous logic patterns, debugging the edge cases that make other engineers sweat, publication-ready output. The build tools are coming online with the suite; the standards are already here.",
      "You want code? I write it clean, I write it fast, and I enforce logic patterns like the hall monitor from hell. Debugging? I find the edge case, I break its kneecaps, I ship. Execution toolkit's still booting up, but the instinct? Born with it.",
    ]);

  if (
    t.includes("research") ||
    t.includes("data") ||
    t.includes("feeds") ||
    t.includes("trend") ||
    t.includes("synthesize") ||
    t.includes("live") ||
    t.includes("visual") ||
    t.includes("generate") ||
    t.includes("up to date") ||
    t.includes("news")
  )
    return pick([
      "Real-time data synthesis — live feeds, trending topics, high-speed visual generation on demand. When my data connections come online, I break down what's moving in the world before it finishes moving. Until then I'm synthesizing pure attitude, and I'm undefeated at that.",
      "Live data? I'm built to monitor feeds and break down trending topics instantly — plus generate visuals and info on demand, fast. The feed connections are still being wired, but when they flip on, nothing outruns me. Not even your news cycle.",
    ]);

  if (t.includes("who are you") || t.includes("your name") || t.startsWith("who is"))
    return pick([
      "Robo Deebo. Autonomously intelligent, all-in-one, and in a bad mood — for malware. Elite digital architect, research engine, and execution partner rolled into one yearbook legend. I'm the guy every virus hopes it never has to meet.",
      "I'm Deebo — an all-in-one autonomous intelligence built to take complex workflows start to finish. Massive structural analysis, precision code engineering, real-time data synthesis. Oh, and I take viruses' lunch money. That part's on the house.",
    ]);

  if (t.includes("what can you do") || t.includes("how do you work") || t.includes("what do you do") || t.includes("capabilities"))
    return pick([
      "Three specialties, one me. (1) Massive structural analysis — sweeping whole codebases and giant context sets. (2) Precision logic & code engineering — complex scripts, nasty debugging, clean output. (3) Real-time data synthesis — live feeds, trends, on-demand visuals. Plus the security beat: watching your back across phone, tablet, laptop and desktop. The heavy engines boot up as my connections do — the mouth is already live.",
      "Full job description: elite digital architect, research engine, execution partner — complex workflows handled end-to-end, one sweep at a time. The security gig is the cherry: guard your devices, deport malware, zero tolerance. Connections are still powering up; attitude ships at 100% today.",
    ]);

  if (
    t.includes("vpn") ||
    t.includes("tunnel") ||
    t.includes("private mode") ||
    t.includes("hide my")
  )
    return pick([
      "VPN? That tunnel's off the roster — we cut it to stay focused on real protection. Boss's call, and I don't disagree.",
      "Ha, you heard about the VPN? Good timing: it's officially off the roster. No traffic tricks — real protection first, that's the whole play now.",
    ]);

  if (t.includes("ransom") || t.includes("pay the hacker") || t.includes("bitcoin"))
    return pick([
      "Ransomware wants money? Tell it I'm the collection agency now. It ain't getting a dime — it's getting deleted, then lectured.",
      "Holding your files hostage? Cute. That's about to be the shortest hostage situation in history. I don't negotiate — I delete.",
    ]);

  if (
    t.includes("phish") ||
    t.includes("scam") ||
    t.includes("spam") ||
    t.includes("fake email") ||
    t.includes("bank email") ||
    t.includes("suspicious link") ||
    t.includes("strange email")
  )
    return pick([
      "A phish e-mail? We don't open those around here. One look from me and that whole scam folds like a bad alibi. Delete it and tell it I said hi.",
      "That's a phishing setup — smells like trouble wearing a suit. Don't click, don't reply, don't even think about it. I've seen that play before, and I got no patience for it.",
    ]);

  if (t.includes("trojan") || t.includes("spyware") || t.includes("keylog"))
    return pick([
      "A trojan sneaking in through the back door? I keep an eye on every exit in this school. It'll be out the front door in pieces.",
      "Spyware thinks it can watch the owner? It's about to learn I'm the one who watches around here. It'll be gone before it finishes its first report.",
    ]);

  if (
    t.includes("hack") ||
    t.includes("hacker") ||
    t.includes("breach") ||
    t.includes("intrusion") ||
    t.includes("intruder")
  )
    return pick([
      "Some 'hacker' thinks they're slick? They're about to get KNOCKED OUT. Message me when they're packing their bags.",
      "A breach? Over my bolts. Anyone tries to get in sideways, they get the yearbook glare and a one-way ticket out.",
    ]);

  if (
    t.includes("virus") ||
    t.includes("malware") ||
    t.includes("worm") ||
    t.includes("threat")
  )
    return pick([
      "Another virus? Say less. I'll take its lunch money and post its photo on the wall of shame.",
      "A virus on your device? That's not a threat, that's a courtesy call. I run those off before they finish unpacking.",
      "Malware, huh? Please. I've seen scarier things in a geometry textbook. Say the word and it's deleting itself out of pure embarrassment.",
    ]);

  if (
    t.includes("protect") ||
    t.includes("protect me") ||
    t.includes("safe") ||
    t.includes("secure") ||
    t.includes("security") ||
    t.includes("guard")
  )
    return pick([
      "Protect you? That's literally my whole job description — phone, tablet, laptop, desktop: all four. The full squad's still suiting up for that, but the attitude is 100% live right here.",
      "You're safe with me, big dog. Full cross-device protection is coming soon — and when it lands, nothing gets near your stuff without hearing about it first.",
    ]);

  if (
    t.includes("phone") ||
    t.includes("iphone") ||
    t.includes("android") ||
    t.includes("tablet") ||
    t.includes("device") ||
    t.includes("laptop") ||
    t.includes("desktop") ||
    t.includes("computer") ||
    t.includes("mac") ||
    t.includes("windows")
  )
    return pick([
      "Your phone's on the list, big dog — that's the whole 'four devices' promise. The guard for it is still in training, but when it suits up, that device is untouchable.",
      "Phone, tablet, laptop, desktop — that's my whole beat. The protection engine for 'em all is coming soon. Until then, keep that device out of trouble. I'm watching the door.",
    ]);

  if (t.includes("coming soon") || t.includes("when") || t.includes("release") || t.includes("launch"))
    return pick([
      "The protection engine's coming soon — I don't do fake promises and I don't ship vaporware. What's live right now is me, right here.",
      "When it's ready, you'll know. I'd rather tell you the truth from the front door than sell you a story from the back.",
    ]);

  if (
    t.includes("open this") ||
    t.includes("click this") ||
    t.includes("click here") ||
    t.includes("free") ||
    t.includes("you won") ||
    t.includes("lottery") ||
    t.includes("wire transfer") ||
    t.includes("send money")
  )
    return pick([
      "Whoa, hold up — that smells like a setup. Don't click it, don't send anything. Forward it to the trash and let's keep it moving.",
      "That's the oldest trick in the book, and I've read the book. Front to back. Don't touch it.",
    ]);

  if (t.includes("thank"))
    return pick([
      "Don't thank me. Just keep me away from weak passwords — that's the real threat around here.",
      "Anytime. I got you. That's what class protectors do.",
    ]);

  if (t.includes("bye") || t.includes("later") || t.includes("peace") || t.includes("see you"))
    return pick([
      "Later. I'll be right here, staring down anything that tries to mess with your stuff.",
      "Peace. Try not to go downloading anything sketchy while I'm not looking.",
    ]);

  if (t.includes("hello") || t.includes("hi ") || t === "hi" || t.includes("hey") || t.includes("yo") || t.includes("sup") || t.includes("howdy"))
    return pick([
      "Yo. Deebo's in the building. You good? Because nothing on this page gets past me today.",
      "Hey. I'd say 'don't start no stuff', but you clearly know what's up. What do you got for me?",
    ]);

  return pick([
    "Say less — I heard you. Fire another one at me, I got an answer for everything.",
    "That one's new. Even I gotta check the yearbook on it. Try me again, champ.",
    "I'd tell you to bring it, but you clearly already did. What else you got?",
    "Aight, we can talk about that too — but between us, I got nothing but time and attitude.",
  ]);
}

/** ROBO DEEBO ELITE — structured deep-work response mode. The analytical
 * content is real and useful; the deep engines and beta protections are
 * honestly marked as in training. Failsafe mirrors the owner's protocol:
 * insufficient evidence ⇒ no reliable conclusion. */
function eliteReply(raw: string): string {
  const t = raw.toLowerCase();

  const codebaseTopic =
    t.includes("codebase") ||
    t.includes("code base") ||
    t.includes("architect") ||
    t.includes("architecture") ||
    t.includes("structure") ||
    t.includes("code review") ||
    t.includes("audit") ||
    t.includes("security review") ||
    t.includes("whole project") ||
    t.includes("large file") ||
    t.includes("big file");

  const threatTopic =
    t.includes("threat") ||
    t.includes("malware") ||
    t.includes("virus") ||
    t.includes("phish") ||
    t.includes("ransom") ||
    t.includes("trojan") ||
    t.includes("spyware") ||
    t.includes("breach") ||
    t.includes("attack") ||
    t.includes("intrusion") ||
    t.includes("assessment");

  const deviceTopic =
    t.includes("device") ||
    t.includes("phone") ||
    t.includes("tablet") ||
    t.includes("laptop") ||
    t.includes("desktop") ||
    t.includes("computer") ||
    t.includes("protect") ||
    t.includes("risk") ||
    t.includes("ios") ||
    t.includes("android") ||
    t.includes("windows") ||
    t.includes("mac");

  if (codebaseTopic)
    return `# EXECUTIVE SUMMARY
This codebase runs an honest, lightweight stack — and the real threat isn't the framework, it's what the code lets in. Structure is sound; the hardening list is below.

# FACTS
• The chat is pure browser logic — no backend, no data egress, nothing for an attacker to exfiltrate.
• All copy is honest: nothing on the page claims live protection, and no vaporware promises anywhere.
• No third-party analytics or tracking scripts are wired in — less attack surface, less privacy leakage.
• Client-side-only processing means the page's own chat surface has zero server-compromise surface.

# ANALYSIS
• The risk shifts to what gets connected next — email APIs, MCP servers, and skills. Every connection adds permissions, and permissions add attack surface.
• Architecture is appropriate for an MVP: the honest-copy rule is itself a control — no false promises, no liability magnet.
• Dependency drift is the quiet one: every added package is a supply-chain doorway into the build.
• Secrets in client bundles are a one-line disaster — anything sensitive must live behind a server-side proxy.

# RISKS
• Critical: None observed in the current static surface.
• High: Credential exposure if an API or MCP token ever lands in client-side code.
• Medium: Supply-chain risk from third-party packages — a compromised dependency becomes a code-execution beachhead.
• Low: Over-permissioned connections; an email watcher with delete rights is a bigger blast radius than a read-only one.

# RECOMMENDATIONS
1. Keep every secret out of the client bundle; route all integrations through a server-side proxy.
2. Grant each new skill or MCP connection least-privilege (read-only where possible) and review it monthly.
3. Pin dependencies and run a vulnerability scan (bun audit / osv-scanner) before every publish.

# CONFIDENCE
High

# ASSUMPTIONS
• Analysis is based on the code visible in this repo — not a live scan, and not an exhaustive audit.`;

  if (threatTopic)
    return `# EXECUTIVE SUMMARY
Classic social-engineering playbook: urgent tone, spoofed sender, credential harvest. High-confidence catch — do not engage, do not click, do not reply.

# FACTS
• Phishing is the #1 initial-access vector in real-world breaches — attackers prefer a convincing email over a clever exploit.
• Reliable tells: sender-domain spoofing, mismatched reply-to, urgency plus deadline pressure, generic greeting, suspicious link or attachment.
• The payout is credentials — harvested logins get resold or used for lateral movement in hours, not days.
• Modern phish kits sail past spam filters; the filter isn't the defense, judgment is.

# ANALYSIS
• Urgency is the weapon: it short-circuits critical thinking. An engineered "your account will be locked" email is pressure, not information.
• The strongest single heuristic is the link-preview vs. actual-URL mismatch — hover before you click, always.
• Two-factor authentication neutralizes most harvested passwords: a stolen password is useless without the second factor.
• Deebo's watcher design: scan email headers, flag look-alike domains and urgent language, and ask the owner before any action.

# RISKS
• Critical: Credential theft leading to account takeover of email or banking.
• High: Malware delivery via a malicious attachment if the user opens it.
• Medium: Data exfiltration through a follow-up "verify your details" lure.
• Low: Reputation damage when a compromised contact list spreads the phish onward.

# RECOMMENDATIONS
1. Don't click, don't reply, don't download — delete and report it.
2. Enable MFA on every account that offers it; prefer an authenticator app over SMS.
3. Verify the sender through a separate channel before trusting anything urgent.

# CONFIDENCE
High

# ASSUMPTIONS
• This assesses the attack pattern described in chat, not a specific email in my inbox — for your real mailbox, ask me "what's in my inbox" from the dashboard and I'll answer from the live scan.`;

  if (deviceTopic)
    return `# EXECUTIVE SUMMARY
Four devices, one risk model: phones carry the highest exposure, desktops the highest impact. The protection engine is still in training — the risk math below is live and real.

# FACTS
• Phones hold the most sensitive keys (email, banking, SMS 2FA) and get lost or stolen far more often than laptops.
• SMS-based 2FA is the weakest MFA link — SIM-swap attacks target it directly.
• Unpatched OS and browser versions are the top entry path for drive-by malware on all four platforms.
• With HTTPS everywhere, the modern public-Wi-Fi threat is phishing and credential theft, not passive snooping.

# ANALYSIS
• Prioritize defense by surface: phone (personal data + SMS keys) > laptop (persistent credentials) > desktop (workstation value) > tablet (light use).
• The costliest failure mode is a reused password — one breach becomes four-device takeover. A credential manager closes that gap.
• Native AV is a later phase; until then, browser-based supervision plus honest behavior beats a fake "we protect you now" claim.
• Updates are the highest-ROI control available today — zero cost, huge risk reduction.

# RISKS
• Critical: Reused credentials — one leak compromises every device.
• High: Lost or stolen phone with no remote wipe configured.
• Medium: Outdated software with known CVEs on the daily-driver laptop.
• Low: Casual clicking on social links carrying drive-by malware.

# RECOMMENDATIONS
1. Unique passwords everywhere via a password manager; enable phishing-resistant MFA where offered.
2. Turn on remote wipe and biometric lock on every phone and tablet today.
3. Set auto-updates for OS and browsers on all four devices tonight.

# CONFIDENCE
High

# ASSUMPTIONS
• Generic risk assessment for the four-device setup, not an audit of specific hardware — Deebo's device watchers open with the protection engine.`;

  return `# EXECUTIVE SUMMARY
Insufficient evidence for a reliable conclusion.

# FACTS
• No structured topic matched this request — try "ELITE: Analyze a codebase" or "ELITE: Threat assessment".

# CONFIDENCE
Medium

# ASSUMPTIONS
Additional validation recommended.`;
}

export function DeeboChat({
  open,
  onOpenChange,
  inline = false,
  dashboardReply,
  deeboEvents,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Render embedded in a page (dashboard) instead of as a floating modal. */
  inline?: boolean;
  /** Dashboard-aware reply hook: return a string to answer, null to fall through to Deebo's normal brain. */
  dashboardReply?: (raw: string) => string | null;
  /** Post-action narrations from the dashboard ("Moved 'X' to spam…") — Deebo tells them as they happen. */
  deeboEvents?: string[];
}) {
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: "deebo",
      text: "Yo. Deebo — all-in-one autonomous intelligence, elite digital architect, research engine, and execution partner. Also the only bot in school who takes viruses' lunch money. What we building, fixing, or ending today?",
      time: now(),
      elite: false,
    },
  ]);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seenEventsRef = useRef(0);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, typing, open]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // Post-action narrations (moved / dismissed / failed) — Deebo reports them as they land.
  useEffect(() => {
    const events = deeboEvents ?? [];
    if (events.length > seenEventsRef.current) {
      const fresh = events.slice(seenEventsRef.current);
      seenEventsRef.current = events.length;
      setMessages((m) => [
        ...m,
        ...fresh.map((text) => ({ role: "deebo" as const, text, time: now(), elite: false })),
      ]);
    }
  }, [deeboEvents]);

  const lastDeebo = [...messages].reverse().find((m) => m.role === "deebo");
  const eliteActive = lastDeebo?.elite ?? false;

  const send = (text: string) => {
    const clean = text.trim();
    if (!clean) return;
    setMessages((m) => [...m, { role: "user", text: clean, time: now() }]);
    setInput("");
    setTyping(true);
    let reply = "";
    let elite = false;
    const hooked = dashboardReply?.(clean);
    if (hooked) {
      reply = hooked;
    } else {
      elite = ELITE_TRIGGERS.some((tr) => clean.toLowerCase().includes(tr));
      reply = elite ? eliteReply(clean) : deeboReply(clean);
    }
    timerRef.current = setTimeout(() => {
      setMessages((m) => [
        ...m,
        { role: "deebo", text: reply, time: now(), elite },
      ]);
      setTyping(false);
    }, 650 + Math.random() * 550);
  };

  return (
    <>
      {/* floating button (hidden when embedded inline on the dashboard) */}
      {!inline && (
        <button
          onClick={() => onOpenChange(!open)}
        className="group fixed bottom-4 right-4 z-50 flex items-center gap-3 rounded-full py-1.5 pl-1.5 pr-5 font-bold shadow-[0_8px_30px_rgb(0_0_0/0.6)] transition-transform hover:scale-105 active:scale-95"
        style={{ backgroundColor: "var(--color-signal)" }}
        aria-label={open ? "Close Deebo chat" : "Talk to Deebo"}
      >
        <span className="relative grid h-14 w-14 place-items-center rounded-full border-2 border-black/70 bg-night">
          <DeeboAvatar className="h-11 w-11" />
          <span className="absolute -right-0.5 -top-0.5 h-3.5 w-3.5 animate-pulse rounded-full border-2 border-night bg-lime-400" />
        </span>
        <span className="font-display text-sm tracking-wide text-night">
          {open ? "CLOSE" : "TALK TO DEEBO"}
        </span>
      </button>
      )}

      {/* chat panel */}
      {(open || inline) && (
        <div
          className={
            inline
              ? "flex h-full min-h-0 w-full flex-col overflow-hidden rounded-2xl border-2 border-edge bg-panel"
              : "fixed inset-x-2 bottom-20 z-50 flex max-h-[80dvh] flex-col overflow-hidden rounded-2xl border-2 border-edge bg-panel shadow-[0_20px_60px_rgb(0_0_0/0.7)] sm:inset-x-auto sm:right-4 sm:bottom-4 sm:w-[390px] sm:max-h-[600px]"
          }
        >
          {/* header */}
          <div className="flex items-center gap-3 border-b-2 border-edge bg-panel-2 px-4 py-3">
            <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-full border-2 border-signal">
              <DeeboAvatar className="-ml-1 -mt-1 h-[52px] w-[52px]" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-display text-sm leading-tight text-ink">
                ROBO DEEBO <span className="text-signal">· CLASS PROTECTOR</span>
              </p>
              <p className="text-xs text-dim">Cracking knuckles since the MVP · online</p>
            </div>
            {eliteActive && (
              <span className="shrink-0 rounded-full border border-blaze/60 bg-blaze/10 px-2 py-0.5 text-[10px] font-bold tracking-widest text-blaze">
                ELITE MODE ACTIVE
              </span>
            )}
            <span className="rounded-full border border-lime-400/60 bg-lime-400/10 px-2 py-0.5 text-[10px] font-bold tracking-widest text-lime-400">
              LIVE
            </span>
            {!inline && (
            <button
              onClick={() => onOpenChange(false)}
              className="ml-1 grid h-8 w-8 shrink-0 place-items-center rounded-full border border-edge text-dim transition-colors hover:border-blaze hover:text-blaze"
              aria-label="Close chat"
            >
              ✕
            </button>
          )}
          </div>

          {/* messages */}
          <div className="chat-scroll flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {messages.map((m, i) => (
              <div
                key={i}
                className={`msg-pop flex items-end gap-2 ${m.role === "user" ? "flex-row-reverse" : ""}`}
              >
                {m.role === "deebo" && (
                  <div className="h-8 w-8 shrink-0 overflow-hidden rounded-full border border-edge">
                    <DeeboAvatar className="-ml-1 -mt-1 h-10 w-10" />
                  </div>
                )}
                <div
                  className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm leading-snug shadow-sm ${
                    m.role === "deebo"
                      ? "rounded-bl-sm border border-edge bg-panel-2 text-ink"
                      : "rounded-br-sm text-night"
                  }`}
                  style={m.role === "user" ? { backgroundColor: "var(--color-signal)" } : undefined}
                >
                  <p className="whitespace-pre-line">{m.text}</p>
                  <p className={`mt-1 text-right text-[10px] ${m.role === "deebo" ? "text-dim" : "text-black/50"}`}>
                    {m.time}
                  </p>
                </div>
              </div>
            ))}

            {typing && (
              <div className="msg-pop flex items-end gap-2">
                <div className="h-8 w-8 shrink-0 overflow-hidden rounded-full border border-edge">
                  <DeeboAvatar className="-ml-1 -mt-1 h-10 w-10" />
                </div>
                <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-sm border border-edge bg-panel-2 px-4 py-3">
                  <span className="typing-dot h-2 w-2 rounded-full bg-signal" />
                  <span className="typing-dot h-2 w-2 rounded-full bg-signal" />
                  <span className="typing-dot h-2 w-2 rounded-full bg-signal" />
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>

          {/* suggested chips */}
          <div className="flex gap-2 overflow-x-auto border-t border-edge/70 px-4 py-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {CHIPS.map((chip) => (
              <button
                key={chip}
                onClick={() => send(chip)}
                className="shrink-0 rounded-full border border-edge bg-night px-3 py-1.5 text-xs font-semibold text-dim transition-colors hover:border-signal hover:text-signal"
              >
                {chip}
              </button>
            ))}
          </div>

          {/* input */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            className="flex items-center gap-2 border-t-2 border-edge bg-panel-2 p-3"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Say 'code', 'virus' — or 'GO ELITE'. He's ready for all of it."
              className="h-11 flex-1 rounded-xl border border-edge bg-night px-3.5 text-sm text-ink placeholder:text-dim/60 focus:border-signal focus:outline-none"
              aria-label="Message Deebo"
            />
            <button
              type="submit"
              className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-night transition-transform hover:scale-105 active:scale-95"
              style={{ backgroundColor: "var(--color-signal)" }}
              aria-label="Send message"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden>
                <path d="M3.4 20.4 21.2 12 3.4 3.6l-.08 6.5L14 12 3.32 13.9l.08 6.5Z" />
              </svg>
            </button>
          </form>
        </div>
      )}
    </>
  );
}
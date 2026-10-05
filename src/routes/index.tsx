import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { DeeboAvatar } from "~/components/DeeboAvatar";
import { DeeboChat } from "~/components/DeeboChat";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  const [chatOpen, setChatOpen] = useState(false);

  return (
    <div className="min-h-dvh bg-night text-ink">
      {/* ============ TOP BAR ============ */}
      <header className="sticky top-0 z-40 border-b border-edge/80 bg-night/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <div className="h-10 w-10 overflow-hidden rounded-full border-2 border-signal">
              <DeeboAvatar className="-ml-1 -mt-1 h-12 w-12" />
            </div>
            <div className="leading-none">
              <p className="font-display text-lg text-signal">ROBO DEEBO</p>
              <p className="text-[10px] font-bold tracking-[0.25em] text-dim">CLASS OF 2026</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden rounded-full border border-blaze/60 bg-blaze/10 px-3 py-1.5 text-[11px] font-bold tracking-widest text-blaze md:inline-block">
              PROTECTION SUITE · COMING SOON
            </span>
            <a
              href="/dashboard"
              className="rounded-full border-2 border-signal px-4 py-2 font-display text-xs tracking-wide text-signal transition-colors hover:bg-signal hover:text-night"
            >
              COPILOT BETA
            </a>
            <button
              onClick={() => setChatOpen(true)}
              className="rounded-full px-4 py-2 font-display text-xs tracking-wide transition-transform hover:scale-105 active:scale-95"
              style={{ backgroundColor: "var(--color-signal)" }}
            >
              TALK TO DEEBO
            </button>
          </div>
        </div>
      </header>

      <main>
        {/* ============ HERO — YEARBOOK COVER ============ */}
        <section className="relative overflow-hidden">
          <div className="dot-grid absolute inset-0" aria-hidden />
          <div
            aria-hidden
            className="absolute -left-32 -top-32 h-96 w-96 rounded-full opacity-20 blur-3xl"
            style={{ backgroundColor: "var(--color-signal)" }}
          />
          <div
            aria-hidden
            className="absolute -bottom-24 -right-24 h-80 w-80 rounded-full opacity-15 blur-3xl"
            style={{ backgroundColor: "var(--color-blaze)" }}
          />

          <div className="relative mx-auto max-w-6xl px-4 pb-16 pt-14 sm:px-6 sm:pt-20">
            <p className="mx-auto w-fit rounded-full border border-signal/50 px-4 py-1.5 text-[11px] font-bold tracking-[0.35em] text-signal">
              ✦ THE CLASS OF 2026 · CLASS PROTECTOR ✦
            </p>

            <h1 className="mt-6 text-center font-display text-5xl leading-[0.95] text-ink sm:text-7xl md:text-8xl">
              ROBO
              <br />
              <span className="text-signal">DEEBO</span>
            </h1>

            <p className="mt-4 text-center font-marker text-xl text-blaze sm:text-2xl">
              "the baddest antivirus in school" — voted by everyone
            </p>

            {/* motto strip */}
            <div className="mt-10 flex justify-center">
              <div
                className="tape-edge max-w-2xl -rotate-1 px-8 py-4 text-center shadow-[0_10px_30px_rgb(0_0_0/0.5)] sm:px-14"
                style={{ backgroundColor: "var(--color-signal)" }}
              >
                <p className="font-display text-sm leading-snug text-night sm:text-base">
                  "DON'T START NO STUFF, WON'T BE NO STUFF."
                </p>
                <p className="mt-1 text-xs font-bold tracking-wide text-black/60 sm:text-sm">
                  MALWARE'S WORST NIGHTMARE · YOUR BEST FRIEND
                </p>
              </div>
            </div>

            <p className="mx-auto mt-8 max-w-2xl text-center text-sm leading-relaxed text-dim sm:text-base">
              One cyber-security supervising agent. Four devices on the list — phone, tablet,
              laptop, desktop. Zero tolerance for anything that tries to mess with your stuff.
              The protection engine's still in training; the attitude is live right now.
            </p>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <button
                onClick={() => setChatOpen(true)}
                className="rounded-full px-7 py-3.5 font-display text-sm tracking-wide transition-transform hover:scale-105 active:scale-95"
                style={{ backgroundColor: "var(--color-signal)" }}
              >
                TALK TO DEEBO ➜
              </button>
              <a
                href="#the-class"
                className="rounded-full border-2 border-edge px-7 py-3 font-display text-sm tracking-wide text-ink transition-colors hover:border-signal hover:text-signal"
              >
                SEE THE CLASS ↓
              </a>
            </div>

            {/* stat strip */}
            <dl className="mx-auto mt-12 grid max-w-3xl grid-cols-3 divide-x divide-edge border border-edge bg-panel/60 text-center">
              <div className="px-4 py-4">
                <dt className="order-2 mt-1 block text-[10px] font-bold tracking-[0.2em] text-dim sm:text-[11px]">
                  DEVICES ON THE LIST
                </dt>
                <dd className="font-display text-2xl text-signal sm:text-3xl">4</dd>
              </div>
              <div className="px-4 py-4">
                <dt className="order-2 mt-1 block text-[10px] font-bold tracking-[0.2em] text-dim sm:text-[11px]">
                  TOLERANCE FOR THREATS
                </dt>
                <dd className="font-display text-2xl text-signal sm:text-3xl">0</dd>
              </div>
              <div className="px-4 py-4">
                <dt className="order-2 mt-1 block text-[10px] font-bold tracking-[0.2em] text-dim sm:text-[11px]">
                  ATTITUDE DELIVERED
                </dt>
                <dd className="font-display text-2xl text-signal sm:text-3xl">100%</dd>
              </div>
            </dl>

            <p className="mt-3 text-center text-[11px] text-dim/70">
              Full protection across those four devices ships with the suite — coming soon. Nothing
              here is guarding hardware yet.
            </p>
          </div>
        </section>

        {/* ============ MEET DEEBO — WHAT HE IS ============ */}
        <section className="border-t border-edge bg-panel/40">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <div className="text-center">
              <p className="font-marker text-xl text-blaze sm:text-2xl">meet the all-in-one…</p>
              <h2 className="mt-1 font-display text-4xl text-ink sm:text-6xl">
                MEET <span className="text-signal">DEEBO</span>
              </h2>
              <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-dim sm:text-base">
                An all-in-one autonomous intelligence built to handle complex workflows
                end-to-end — elite digital architect, research engine, and execution partner,
                rolled into one very confident robot.
              </p>
            </div>

            <div className="mt-10 grid grid-cols-1 gap-5 md:grid-cols-3">
              {[
                {
                  num: "01",
                  title: "MASSIVE STRUCTURAL ANALYSIS",
                  body: "Seamlessly processes ultra-large files, massive codebases, and expansive context sets in a single sweep — mapping system architectures and cross-file dependencies effortlessly.",
                },
                {
                  num: "02",
                  title: "PRECISION LOGIC & CODE ENGINEERING",
                  body: "Built for deep technical reasoning: writing complex scripts, enforcing meticulous logic patterns, debugging intricate edge cases, and delivering publication-ready text or code.",
                },
                {
                  num: "03",
                  title: "REAL-TIME DATA SYNTHESIS & SPEED",
                  body: "Monitors live data feeds, breaks down trending topics instantly, and executes high-speed visual and informational generation on demand.",
                },
              ].map((p) => (
                <div
                  key={p.num}
                  className="relative flex h-full flex-col rounded-3xl border-2 border-edge bg-panel p-6"
                >
                  <span className="font-display text-4xl text-signal/30">{p.num}</span>
                  <h3 className="mt-3 font-display text-lg leading-tight text-ink">{p.title}</h3>
                  <p className="mt-3 text-xs leading-relaxed text-dim sm:text-sm">{p.body}</p>
                </div>
              ))}
            </div>

            <p className="mx-auto mt-8 max-w-xl text-center font-marker text-base text-blaze">
              "one all-in-one. zero tolerance." — deebo, probably
            </p>
            <p className="mx-auto mt-2 max-w-xl text-center text-[11px] text-dim/70">
              These powers come online as Deebo's connections do — email patrol first, then the
              rest of the stack. No protection claims until they're real.
            </p>
          </div>
        </section>

        {/* ============ THE CLASS — PORTRAIT WALL ============ */}
        <section id="the-class" className="border-t border-edge bg-panel/40">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <div className="text-center">
              <p className="font-marker text-xl text-blaze sm:text-2xl">flip through…</p>
              <h2 className="mt-1 font-display text-4xl text-ink sm:text-6xl">
                THE <span className="text-signal">CLASS</span>
              </h2>
              <p className="mx-auto mt-3 max-w-xl text-sm text-dim">
                The whole team, one yearbook at a time. Deebo's the star everybody's too scared to
                talk to — until they need a threat dealt with.
              </p>
            </div>

            {/* portrait grid */}
            <div className="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {/* --- DEEBO — THE STAR (biggest card) --- */}
              <div className="relative sm:col-span-2 lg:col-span-2">
                <div
                  aria-hidden
                  className="absolute inset-x-8 top-4 h-1 rotate-[-1deg]"
                  style={{ backgroundColor: "var(--color-blaze)" }}
                />
                <div className="relative flex h-full flex-col items-center overflow-hidden rounded-3xl border-2 border-signal/70 bg-panel p-6 shadow-[0_20px_60px_rgb(255_196_0/0.08)] sm:p-8">
                  <div className="absolute left-4 top-4 rounded-full bg-signal px-3 py-1 text-[10px] font-bold tracking-[0.2em] text-night">
                    ★ STAR PLAYER
                  </div>
                  <span className="absolute right-4 top-4 font-marker text-lg text-blaze">"yo."</span>

                  <div className="glow-float relative mt-4 h-44 w-44 sm:h-52 sm:w-52">
                    <div
                      aria-hidden
                      className="absolute inset-3 rounded-full blur-2xl opacity-30"
                      style={{ backgroundColor: "var(--color-signal)" }}
                    />
                    <div className="relative overflow-hidden rounded-full border-4 border-signal">
                      <DeeboAvatar className="h-full w-full" />
                    </div>
                  </div>

                  <h3 className="mt-5 text-center font-display text-3xl text-ink sm:text-4xl">
                    ROBO DEEBO
                  </h3>
                  <p className="mt-2 text-center text-sm font-semibold text-signal">
                    Class Protector · Most Likely To Delete Your Malware
                  </p>
                  <p className="mt-3 max-w-md text-center text-xs leading-relaxed text-dim sm:text-sm">
                    Guards the yearbook. Guards you. Takes viruses' lunch money and doesn't even
                    break a servo. Chat with him — he's live right now and he remembers everyone's
                    least favorite class: ransomware.
                  </p>
                  <button
                    onClick={() => setChatOpen(true)}
                    className="mt-6 rounded-full px-6 py-2.5 font-display text-xs tracking-wide transition-transform hover:scale-105 active:scale-95"
                    style={{ backgroundColor: "var(--color-signal)" }}
                  >
                    🗨 CHAT WITH DEEBO NOW
                  </button>
                </div>
              </div>

              {/* --- ENGINEER --- */}
              <div className="relative flex h-full flex-col items-center rounded-3xl border-2 border-edge bg-panel p-6">
                <span className="absolute right-4 top-4 font-marker text-lg text-blaze">"ship it."</span>
                <div className="mt-2 h-32 w-32 overflow-hidden rounded-full border-2 border-edge">
                  <div className="grid h-full w-full place-items-center bg-panel-2">
                    <svg viewBox="0 0 64 64" className="h-16 w-16" fill="none" stroke="var(--color-signal)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <rect x="14" y="20" width="36" height="26" rx="6" />
                      <circle cx="26" cy="33" r="3" fill="var(--color-signal)" stroke="none" />
                      <circle cx="38" cy="33" r="3" fill="var(--color-signal)" stroke="none" />
                      <path d="M22 44l-3 8M42 44l3 8" />
                      <path d="M10 14h8l4 6M46 14h8l-4 6" />
                    </svg>
                  </div>
                </div>
                <h3 className="mt-4 text-center font-display text-xl text-ink">THE ENGINEER</h3>
                <p className="mt-2 text-center text-sm font-semibold text-signal">
                  Most Likely To Ship On Time
                </p>
                <p className="mt-3 text-center text-xs leading-relaxed text-dim">
                  Built this whole yearbook. Loyal to the squad, allergic to half-baked code, and
                  personally responsible for Deebo's mouth being as fast as it is.
                </p>
                <span className="mt-auto pt-4 text-[10px] font-bold tracking-[0.25em] text-dim">
                  STATUS: BUILDING THE SQUAD
                </span>
              </div>

              {/* --- TBD CLASSMATES --- */}
              {[
                {
                  tag: "MYSTERY CLASSMATE",
                  note: "An agent with your name on their jersey. Recruiting now.",
                  icon: "?",
                },
                {
                  tag: "MYSTERY CLASSMATE",
                  note: "Every yearbook needs a couple of blank pages. Meet back here soon.",
                  icon: "?",
                },
              ].map((c, i) => (
                <div
                  key={i}
                  className="flex h-full flex-col items-center rounded-3xl border-2 border-dashed border-edge bg-night/40 p-6"
                >
                  <div className="mt-2 grid h-32 w-32 place-items-center rounded-full border-2 border-dashed border-edge bg-panel">
                    <span className="font-display text-5xl text-dim/50">{c.icon}</span>
                  </div>
                  <h3 className="mt-4 text-center font-display text-xl text-dim">{c.tag}</h3>
                  <p className="mt-2 text-center text-xs leading-relaxed text-dim/70">{c.note}</p>
                  <span className="mt-auto pt-4 text-[10px] font-bold tracking-[0.25em] text-blaze">
                    TBD · CLASS OF 2027
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ============ HOME FIELD ADVANTAGE ============ */}
        <section id="home-field" className="border-t border-edge">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <div className="text-center">
              <p className="font-marker text-xl text-blaze sm:text-2xl">where the team plays…</p>
              <h2 className="mt-1 font-display text-4xl text-ink sm:text-6xl">
                HOME FIELD <span className="text-signal">ADVANTAGE</span>
              </h2>
              <p className="mx-auto mt-3 max-w-xl text-sm text-dim">
                Every site the squad ships is a home game. The Front Door is home base — and the
                owner's other turf is live on the board too. More coming.
              </p>
            </div>

            <div className="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {/* LIVE CARD — this site */}
              <div className="relative flex h-full flex-col rounded-3xl border-2 border-signal/70 bg-panel p-6 shadow-[0_20px_60px_rgb(255_196_0/0.07)]">
                <div className="flex items-start justify-between">
                  <span className="rounded-full bg-lime-400/10 px-3 py-1 text-[10px] font-bold tracking-[0.2em] text-lime-400 ring-1 ring-lime-400/50">
                    ● LIVE NOW
                  </span>
                  <span className="font-marker text-lg text-blaze">"we eatin'."</span>
                </div>
                <h3 className="mt-4 font-display text-2xl text-ink">THE FRONT DOOR</h3>
                <p className="mt-1 text-[11px] font-bold tracking-[0.25em] text-signal">ROBO DEEBO · LANDING PAGE</p>
                <p className="mt-3 text-xs leading-relaxed text-dim sm:text-sm">
                  The yearbook itself. Meet the class, check the home schedule, and trash-talk with
                  Deebo in the corner — he's home here.
                </p>
                <div className="mt-auto pt-4">
                  <button
                    onClick={() => setChatOpen(true)}
                    className="w-full rounded-xl border-2 border-signal px-4 py-2.5 font-display text-xs tracking-wide text-signal transition-colors hover:bg-signal hover:text-night"
                  >
                    TALK TO HIM AT HOME ➜
                  </button>
                </div>
              </div>

              {/* LIVE CARD — 3twoapex.com */}
              <div className="relative flex h-full flex-col rounded-3xl border-2 border-signal/70 bg-panel p-6 shadow-[0_20px_60px_rgb(255_196_0/0.07)]">
                <div className="flex items-start justify-between">
                  <span className="rounded-full bg-lime-400/10 px-3 py-1 text-[10px] font-bold tracking-[0.2em] text-lime-400 ring-1 ring-lime-400/50">
                    ● LIVE NOW
                  </span>
                  <span className="font-marker text-lg text-blaze">"no benchwarmers."</span>
                </div>
                <h3 className="mt-4 font-display text-2xl text-ink">3TWO APEX SOLUTIONS</h3>
                <p className="mt-1 text-[11px] font-bold tracking-[0.25em] text-signal">ERGONOMICS · WELLNESS · LAS VEGAS</p>
                <p className="mt-3 text-xs leading-relaxed text-dim sm:text-sm">
                  Evidence-based ergonomics, kinesiology, and workplace wellness assessments for the
                  Las Vegas valley — individual assessments, scored risk reports, and 2–6 week
                  protocols. Deebo approves of protecting the workforce.
                </p>
                <div className="mt-auto pt-4">
                  <a
                    href="https://3twoapex.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block w-full rounded-xl border-2 border-signal px-4 py-2.5 text-center font-display text-xs tracking-wide text-signal transition-colors hover:bg-signal hover:text-night"
                  >
                    VISIT THE SITE ➜
                  </a>
                </div>
              </div>

              {/* LIVE CARD — OcuCon */}
              <div className="relative flex h-full flex-col rounded-3xl border-2 border-signal/70 bg-panel p-6 shadow-[0_20px_60px_rgb(255_196_0/0.07)]">
                <div className="flex items-start justify-between">
                  <span className="rounded-full bg-lime-400/10 px-3 py-1 text-[10px] font-bold tracking-[0.2em] text-lime-400 ring-1 ring-lime-400/50">
                    ● LIVE NOW
                  </span>
                  <span className="font-marker text-lg text-blaze">"eyes on the prize."</span>
                </div>
                <h3 className="mt-4 font-display text-2xl text-ink">OcuCon</h3>
                <p className="mt-1 text-[11px] font-bold tracking-[0.25em] text-signal">CONCUSSION & TBI DECISION SUPPORT</p>
                <p className="mt-3 text-xs leading-relaxed text-dim sm:text-sm">
                  Sideline concussion &amp; TBI decision support: on-device optical oculomotor checks
                  (pupillary, saccade, pursuit, convergence) graded into mild / moderate / severe
                  with next-step protocols. Video stays on the device — Deebo would have it no other
                  way.
                </p>
                <div className="mt-auto pt-4">
                  <a
                    href="https://dfbd01f9a07b47e6a441740c35288364.ctonew.app"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block w-full rounded-xl border-2 border-signal px-4 py-2.5 text-center font-display text-xs tracking-wide text-signal transition-colors hover:bg-signal hover:text-night"
                  >
                    VISIT THE SITE ➜
                  </a>
                </div>
              </div>

              {/* TBD SLOTS */}
              {[
                {
                  name: "PHONE DEFENSE",
                  sub: "TRAINING CAMP",
                  note: "The guard for your pocket. Ringside seat for anything that tries to sneak in.",
                },
                {
                  name: "DESKTOP & TABLET",
                  sub: "THE PRO PACK",
                  note: "Full-court pressure on every device you actually get work done on.",
                },
              ].map((f, i) => (
                <div
                  key={i}
                  className="flex h-full flex-col rounded-3xl border-2 border-dashed border-edge bg-night/40 p-6"
                >
                  <span className="w-fit rounded-full bg-blaze/10 px-3 py-1 text-[10px] font-bold tracking-[0.2em] text-blaze ring-1 ring-blaze/40">
                    COMING SOON
                  </span>
                  <h3 className="mt-4 font-display text-2xl text-dim">{f.name}</h3>
                  <p className="mt-1 text-[11px] font-bold tracking-[0.25em] text-blaze/80">{f.sub}</p>
                  <p className="mt-3 text-xs leading-relaxed text-dim/70">{f.note}</p>
                  <p className="mt-auto pt-5 font-marker text-sm text-dim/60">in training — don't rush the champ</p>
                </div>
              ))}
            </div>
            {/* COPILOT BETA CTA — the dashboard */}
            <div className="mt-10 flex flex-col items-center justify-between gap-6 overflow-hidden rounded-3xl border-2 border-signal/60 bg-panel p-8 shadow-[0_20px_60px_rgb(255_196_0/0.08)] sm:flex-row sm:p-10">
              <div>
                <p className="font-marker text-xl text-blaze sm:text-2xl">the copilot's on the bench. until now.</p>
                <h3 className="mt-1 font-display text-2xl text-ink sm:text-3xl">
                  THE <span className="text-signal">COPILOT BETA</span> IS OPEN
                </h3>
                <p className="mt-2 max-w-xl text-xs leading-relaxed text-dim sm:text-sm">
                  Invite-gated free beta: connect your email, watch Inbox Patrol score messages with
                  Deebo's honest phishing engine, and talk to him from his own desk. The gate's a
                  passcode for now — real accounts are on the way. Nothing here claims to
                  guard a live inbox yet; that's the point of the beta.
                </p>
              </div>
              <a
                href="/dashboard"
                className="shrink-0 rounded-full px-8 py-4 font-display text-sm tracking-wide text-night transition-transform hover:scale-105 active:scale-95"
                style={{ backgroundColor: "var(--color-signal)" }}
              >
                ENTER THE BETA →
              </a>
            </div>
          </div>
        </section>
        {/* ============ WATCH — HOW WE BUILT DEEBO ============ */}
        <section className="border-t border-edge">
          <div className="mx-auto max-w-4xl px-4 py-16 text-center sm:px-6">
            <p className="font-marker text-2xl text-blaze sm:text-3xl">roll the tape…</p>
            <h2 className="mt-2 font-display text-3xl text-ink sm:text-5xl">
              HOW WE <span className="text-signal">BUILT</span> DEEBO
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-dim sm:text-base">
              Forty-four seconds. From malware prowling to the baddest antivirus in school suiting
              up and hitting the yearbook. Hit play — he's been waiting for an audience.
            </p>
            <div className="mt-8 overflow-hidden rounded-3xl border-2 border-signal/60 bg-panel shadow-[0_20px_60px_rgb(255_196_0/0.08)]">
              <video
                controls
                preload="metadata"
                poster="/deebo-animation-poster.png"
                className="aspect-video w-full bg-black"
              >
                <source src="/deebo-animation-share.mp4" type="video/mp4" />
                Your browser doesn't support video — Deebo's disappointed.
              </video>
            </div>
            <p className="mt-3 text-[11px] text-dim/70">
              The film shows early concept art — not everything in it made the roster. No fake
              promises, ever.
            </p>
          </div>
        </section>

        {/* ============ CHAT CTA BAND ============ */}
        <section className="border-t border-edge bg-panel/60">
          <div className="mx-auto max-w-4xl px-4 py-16 text-center sm:px-6">
            <p className="font-marker text-2xl text-blaze sm:text-3xl">give him some lip.</p>
            <h2 className="mt-2 font-display text-3xl text-ink sm:text-5xl">
              DEEBO'S <span className="text-signal">LIVE</span> RIGHT NOW
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-dim sm:text-base">
              No accounts. No downloads. No nonsense. Pop the chat open and talk trash with the
              class protector — he's been waiting for you to walk in.
            </p>
            <button
              onClick={() => setChatOpen(true)}
              className="mt-8 rounded-full px-8 py-4 font-display text-sm tracking-wide transition-transform hover:scale-105 active:scale-95"
              style={{ backgroundColor: "var(--color-signal)" }}
            >
              💬 OPEN THE CHAT
            </button>
          </div>
        </section>
      </main>

      {/* ============ FOOTER — HONEST POSITIONING ============ */}
      <footer className="border-t-2 border-edge bg-night">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
          <div className="grid gap-8 sm:grid-cols-[1fr_auto] sm:items-start">
            <div>
              <div className="flex items-center gap-3">
                <div className="h-12 w-12 overflow-hidden rounded-full border-2 border-signal">
                  <DeeboAvatar className="-ml-1 -mt-1 h-14 w-14" />
                </div>
                <div>
                  <p className="font-display text-xl text-ink">ROBO DEEBO</p>
                  <p className="text-[10px] font-bold tracking-[0.25em] text-dim">
                    CLASS OF 2026 · THE FRONT DOOR
                  </p>
                </div>
              </div>

              {/* honesty corner */}
              <div className="mt-6 max-w-2xl rounded-2xl border border-blaze/50 bg-blaze/5 p-5">
                <p className="font-marker text-base text-blaze">the honesty corner — no cap:</p>
                <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-dim sm:text-sm">
                  <li>
                    <span className="font-bold text-ink">Live today:</span> this page and the chat with
                    Deebo. He's real, he's here, he's got opinions about malware.
                  </li>
                  <li>
                    <span className="font-bold text-ink">In training:</span> the full cross-device
                    protection engine — marked <em>coming soon</em>, and he'd be the first to tell
                    you.
                  </li>
                  <li>
                    <span className="font-bold text-blaze">Straight up:</span> Robo Deebo isn't
                    guarding a single device yet. No protection claims — just a yearbook and a
                    whole lot of attitude.
                  </li>
                </ul>
              </div>
            </div>

            <div className="text-right text-[11px] leading-relaxed text-dim/70">
              <p className="font-display text-sm tracking-wide text-dim">ROBO DEEBO™</p>
              <p className="mt-1">Protecting everything you own.</p>
              <p>Eventually. For real.</p>
              <p className="mt-3 text-dim/50">© 2026 The Robo Deebo Squad</p>
            </div>
          </div>
        </div>
      </footer>

      {/* ============ CHAT ============ */}
      <DeeboChat open={chatOpen} onOpenChange={setChatOpen} />
    </div>
  );
}
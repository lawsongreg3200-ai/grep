# Design reference — copy the old 3twostudios.space look (owner directive)

The owner REJECTED the current v1 design and directed us to copy the layout and
visual style of their old site: https://3twostudios.space (their own build — a
React SPA; view it with agent-browser to see it rendered, and fetch
/static/js/main.406ceb19.js for exact tokens).

## Captured design tokens (from the old site's bundle)
- Background: `#0A0A1F` (very dark indigo), white text, `min-h-screen`
- Grid background: fine grid pattern ("grid-bg"), low opacity
- Primary accent: purple `#B57BE0` — labels, chips, gradient washes
  (`from-[#B57BE0]/20 to-transparent`)
- Secondary accent: green `#00C853` — sparingly, on one key word/phrase
- Error red `#ef4444` — errors only
- Panels/cards: `border border-white/10`, `overflow-hidden`, scanline sweep
  animation across the top while scanning
- Buttons: `border border-white/15 px-5 py-2.5 text-xs tracking-widest`,
  uppercase, hover transition
- Typography: Inter (Google Fonts 400/600/900). Display headlines
  `font-black tracking-tighter text-3xl sm:text-4xl` (often two lines).
  Micro-labels: uppercase `text-[11px] tracking-[0.25em]` / `tracking-widest`.
  Secondary text white/50–white/60.
- Motion: fade/slide entrances (old build used framer-motion; CSS keyframes are
  fine — keep deps minimal, your call)
- Scan stages cycle as uppercase micro-labels ("ESTABLISHING CONNECTION",
  "FETCHING SOURCES", …) — we already have real stages; dress them like this

## Layout mapping (old → new, structure only)
1. Hero: centered, max-w-2xl — two-line display headline + white/55 subhead +
   the URL input front and center. Headline must stay honest (no "truth",
   no fear) — e.g. "What does this website promise?" / "And what backs it up?"
   with the COPY.md promise line as subhead.
2. Below hero: 2x2 card grid of WHAT WE CHECK (rename honestly, not "engines"):
   Domain Basics · Legal Pages · Claims & Promises · Scripts & Trackers —
   icon + name + one-line desc, styled exactly like the old cards.
3. Scanning state: bordered panel + scanline sweep + cycling real stage labels.
4. Report page: same dark panel style — uppercase micro-label headers
   (TARGET · SCANNED · METHOD), findings rows with claim, status chip, note,
   source link. Table borders white/10.
5. Pricing/Methodology/Self-audit/Terms: same panel + micro-label language.
6. Footer: minimal, small links (Methodology · Pricing · Self-audit · Terms)
   + "© 2026 3Two Studios".

## HARD BOUNDARY (unchanged)
Style and layout only. ALL honesty rules from SPEC.md/COPY.md still apply:
no integrity score, no dial/gauge as a result, no locked engines, no teaser
headlines, no "truth/verdict/expose" copy, no fake counters. The old site's
CONTENT was the problem; its LOOK is what we're taking.

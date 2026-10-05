// Robo Deebo's portrait — a no-nonsense robot bust inside a yearbook oval.
// Built entirely in SVG/CSS: metal head, angry glowing eyes, battle scar,
// warning-light antenna, and the "D" on his chest.
export function DeeboAvatar({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 200 200"
      className={className}
      role="img"
      aria-label="Robo Deebo, the class protector"
    >
      <defs>
        <linearGradient id="deebo-metal" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#26262f" />
          <stop offset="1" stopColor="#13131a" />
        </linearGradient>
        <linearGradient id="deebo-face" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#181821" />
          <stop offset="1" stopColor="#0c0c11" />
        </linearGradient>
      </defs>

      {/* yearbook oval */}
      <ellipse cx="100" cy="102" rx="96" ry="94" fill="var(--color-signal)" />
      <ellipse cx="100" cy="102" rx="90" ry="88" fill="#0d0d12" />
      <ellipse cx="100" cy="102" rx="90" ry="88" fill="none" stroke="#2b2b38" strokeWidth="2" />

      {/* shoulders */}
      <path
        d="M50 168 Q60 150 100 150 Q140 150 150 168 L158 196 Q116 208 84 202 L42 196 Z"
        fill="url(#deebo-metal)"
        stroke="#38384a"
        strokeWidth="3"
      />
      <circle cx="64" cy="176" r="3" fill="#2b2b38" />
      <circle cx="136" cy="176" r="3" fill="#2b2b38" />

      {/* chest emblem */}
      <rect x="88" y="170" width="24" height="18" rx="4" fill="var(--color-signal)" />
      <text
        x="100"
        y="184"
        textAnchor="middle"
        fontFamily="'Alfa Slab One', Georgia, serif"
        fontSize="13"
        fill="#0a0a0e"
      >
        D
      </text>

      {/* neck */}
      <rect x="93" y="40" width="14" height="16" rx="3" fill="#38384a" />

      {/* head */}
      <rect x="58" y="28" width="84" height="88" rx="20" fill="url(#deebo-metal)" stroke="#38384a" strokeWidth="3" />

      {/* side bolts */}
      <circle cx="70" cy="66" r="3.5" fill="var(--color-signal)" />
      <circle cx="130" cy="66" r="3.5" fill="var(--color-signal)" />

      {/* antenna + blinking warning light */}
      <line x1="100" y1="28" x2="100" y2="14" stroke="#38384a" strokeWidth="5" strokeLinecap="round" />
      <circle cx="100" cy="12" r="6" fill="var(--color-signal)" className="animate-blink" />
      <circle cx="100" cy="12" r="11" fill="none" stroke="var(--color-signal)" strokeOpacity="0.3" />

      {/* battle scar */}
      <line x1="122" y1="46" x2="134" y2="62" stroke="var(--color-blaze)" strokeWidth="3.5" strokeLinecap="round" opacity="0.9" />

      {/* face plate */}
      <rect x="66" y="40" width="68" height="62" rx="12" fill="url(#deebo-face)" stroke="#33333f" strokeWidth="2" />

      {/* forehead warning triangle */}
      <path d="M92 50 L108 50 L100 61 Z" fill="none" stroke="var(--color-blaze)" strokeWidth="3" strokeLinejoin="round" />
      <line x1="100" y1="53" x2="100" y2="57" stroke="var(--color-blaze)" strokeWidth="2" />
      <circle cx="100" cy="59.6" r="1.3" fill="var(--color-blaze)" />

      {/* angry brow ridge */}
      <path d="M77 66 L98 73" stroke="var(--color-signal)" strokeWidth="4.5" strokeLinecap="round" />
      <path d="M123 66 L102 73" stroke="var(--color-signal)" strokeWidth="4.5" strokeLinecap="round" />

      {/* glowing slanted eyes */}
      <path d="M73 89 L89 78 L96 82 L80 93 Z" fill="var(--color-signal)" />
      <path d="M127 89 L111 78 L104 82 L120 93 Z" fill="var(--color-signal)" />
      <ellipse cx="85" cy="85" rx="4.5" ry="2.2" fill="#fff3c4" opacity="0.95" />
      <ellipse cx="115" cy="85" rx="4.5" ry="2.2" fill="#fff3c4" opacity="0.95" />

      {/* cheek vents */}
      <circle cx="74" cy="94" r="1.6" fill="#33333f" />
      <circle cx="126" cy="94" r="1.6" fill="#33333f" />

      {/* grill mouth — smirk (right side shorter) */}
      <rect x="77" y="87" width="46" height="5" rx="2.5" fill="#0c0c11" stroke="#2b2b38" strokeWidth="1" />
      <rect x="77" y="95" width="40" height="5" rx="2.5" fill="#0c0c11" stroke="#2b2b38" strokeWidth="1" />
      <rect x="77" y="103" width="28" height="5" rx="2.5" fill="#0c0c11" stroke="#2b2b38" strokeWidth="1" />
    </svg>
  );
}
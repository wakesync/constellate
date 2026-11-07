// SVG library, ported from landing. Same visual language.
// Oxblood ink on parchment, monoline, one asterism allowed.

export function Asterism({
  className = "",
  color = "var(--oxblood)",
  accent = "var(--gold)",
  size = 80,
}: {
  className?: string;
  color?: string;
  accent?: string;
  size?: number;
}) {
  return (
    <svg
      viewBox="0 0 120 80"
      width={size}
      height={(size * 80) / 120}
      className={className}
      aria-hidden="true"
    >
      <g fill="none" stroke={color} strokeLinecap="round" opacity="0.82">
        <path d="M 17.4 22.6 Q 33 17.8, 47.6 13.5" strokeWidth="0.95" />
        <path d="M 48.4 14.4 Q 63 22.5, 77.5 32" strokeWidth="1.15" />
        <path d="M 78.6 31.6 Q 90 25.4, 101.8 20.2" strokeWidth="0.8" />
        <path d="M 48.6 14.8 Q 56 35, 61.4 57.8" strokeWidth="1.05" />
        <path d="M 77.6 32.3 Q 69.8 44.6, 62.4 57.6" strokeWidth="0.9" />
      </g>
      <g fill="none" stroke={color} strokeLinecap="round" opacity="0.18" strokeWidth="0.5">
        <path d="M 18 23 Q 40 40, 62 58" />
      </g>
      <g>
        <circle cx="47.6" cy="13.6" r="2.6" fill={accent} />
        <circle cx="47.6" cy="13.6" r="2.6" fill="none" stroke="var(--oxblood-deep)" strokeWidth="0.35" opacity="0.55" />
        <circle cx="46.8" cy="12.9" r="0.55" fill="#e8cf86" opacity="0.85" />
        <circle cx="62" cy="57.9" r="3" fill={accent} />
        <circle cx="62" cy="57.9" r="3" fill="none" stroke="var(--oxblood-deep)" strokeWidth="0.4" opacity="0.6" />
        <circle cx="61.1" cy="57.1" r="0.65" fill="#e8cf86" opacity="0.9" />
      </g>
      <g fill={color}>
        <circle cx="17.6" cy="22.4" r="1.55" />
        <circle cx="78.3" cy="31.7" r="1.85" />
        <circle cx="101.6" cy="20.1" r="1.3" />
      </g>
      <circle cx="62" cy="57.9" r="4.2" fill={accent} opacity="0.08" />
    </svg>
  );
}

export function TinyStar({
  className = "",
  color = "var(--gold)",
  size = 10,
}: {
  className?: string;
  color?: string;
  size?: number;
}) {
  return (
    <svg
      viewBox="0 0 20 20"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
    >
      <g fill={color}>
        <path d="M10 1 L11.2 8.4 L18.5 10 L11.2 11.6 L10 19 L8.8 11.6 L1.5 10 L8.8 8.4 Z" />
      </g>
    </svg>
  );
}

export function Wordmark({
  className = "",
  size = "text-2xl",
}: {
  className?: string;
  size?: string;
}) {
  return (
    <span className={`relative inline-flex flex-col items-center ${className}`}>
      <TinyStar className="star-mark mb-0.5" color="var(--gold)" size={9} />
      <span
        className={`font-display ${size} tracking-[-0.02em] lowercase`}
        style={{ color: "var(--ink)", fontFeatureSettings: '"liga" 1, "dlig" 1' }}
      >
        constellate
      </span>
    </span>
  );
}

export function Flourish({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 24" width="200" height="24" className={className} aria-hidden="true">
      <g
        fill="none"
        stroke="var(--gold)"
        strokeWidth="0.8"
        strokeLinecap="round"
        opacity="0.8"
      >
        <path d="M2 12 L 80 12" />
        <path d="M120 12 L 198 12" />
        <path d="M80 12 Q 88 6, 96 12 Q 104 18, 112 12" />
        <path d="M88 12 Q 100 4, 112 12" opacity="0.5" />
      </g>
      <circle cx="100" cy="12" r="1.6" fill="var(--gold)" />
    </svg>
  );
}

// monoline nav icons
export function IconHome({ className = "", size = 22 }: { className?: string; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 11 L12 3 L21 11" />
        <path d="M5 10 L5 20 L19 20 L19 10" />
        <path d="M10 20 L10 14 L14 14 L14 20" />
      </g>
    </svg>
  );
}

export function IconChart({ className = "", size = 22 }: { className?: string; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="12" r="6" />
        <line x1="3" y1="12" x2="21" y2="12" />
        <line x1="12" y1="3" x2="12" y2="21" />
        <line x1="5.5" y1="5.5" x2="18.5" y2="18.5" opacity="0.5" />
        <line x1="18.5" y1="5.5" x2="5.5" y2="18.5" opacity="0.5" />
      </g>
    </svg>
  );
}

export function IconQuillNav({ className = "", size = 22 }: { className?: string; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 19 C 9 15, 15 9, 20 4 C 19 10, 16 16, 10 19 Z" />
        <path d="M3 21 Q 8 21, 13 20" />
      </g>
    </svg>
  );
}

export function IconAtlas({ className = "", size = 22 }: { className?: string; size?: number }) {
  // a meridian globe: equator, two meridians, a tilted ring. reads as an
  // old cartographer's mark rather than a pin-drop map icon.
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
        <circle cx="12" cy="12" r="9" />
        <line x1="3" y1="12" x2="21" y2="12" />
        <ellipse cx="12" cy="12" rx="4" ry="9" />
        <ellipse cx="12" cy="12" rx="9" ry="4" opacity="0.55" />
      </g>
    </svg>
  );
}

export function IconGroup({ className = "", size = 22 }: { className?: string; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
        <circle cx="9" cy="6" r="1.8" />
        <circle cx="16" cy="8" r="1.5" />
        <circle cx="6" cy="14" r="1.6" />
        <circle cx="14" cy="16" r="1.8" />
        <circle cx="19" cy="13" r="1.4" />
        <line x1="9" y1="6" x2="16" y2="8" opacity="0.7" />
        <line x1="9" y1="6" x2="6" y2="14" opacity="0.7" />
        <line x1="16" y1="8" x2="14" y2="16" opacity="0.7" />
        <line x1="14" y1="16" x2="19" y2="13" opacity="0.7" />
        <line x1="16" y1="8" x2="19" y2="13" opacity="0.7" />
        <line x1="6" y1="14" x2="14" y2="16" opacity="0.7" />
      </g>
    </svg>
  );
}

export function IconKey({ className = "", size = 18 }: { className?: string; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="8" cy="12" r="4" />
        <path d="M12 12 L22 12" />
        <path d="M18 12 L18 16" />
        <path d="M21 12 L21 15" />
      </g>
    </svg>
  );
}

export function IconBack({ className = "", size = 22 }: { className?: string; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 6 L8 12 L14 18" />
      </g>
    </svg>
  );
}

export function IconLock({ className = "", size = 14 }: { className?: string; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <rect x="5" y="11" width="14" height="9" rx="1" />
        <path d="M8 11 V8 a4 4 0 0 1 8 0 V11" />
      </g>
    </svg>
  );
}

export function IconShare({ className = "", size = 14 }: { className?: string; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
        <circle cx="6" cy="12" r="2.4" />
        <circle cx="18" cy="6" r="2.4" />
        <circle cx="18" cy="18" r="2.4" />
        <line x1="8" y1="11" x2="16" y2="7" />
        <line x1="8" y1="13" x2="16" y2="17" />
      </g>
    </svg>
  );
}

export function IconCheck({ className = "", size = 16 }: { className?: string; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12 L10 17 L19 7" />
      </g>
    </svg>
  );
}

export function IconCopy({ className = "", size = 16 }: { className?: string; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
        <rect x="8" y="8" width="12" height="12" rx="1" />
        <path d="M16 8 V5 a1 1 0 0 0 -1 -1 H5 a1 1 0 0 0 -1 1 v10 a1 1 0 0 0 1 1 H8" />
      </g>
    </svg>
  );
}

export function IconPlus({ className = "", size = 18 }: { className?: string; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
        <line x1="12" y1="5" x2="12" y2="19" />
        <line x1="5" y1="12" x2="19" y2="12" />
      </g>
    </svg>
  );
}

// two stars joined by a line: the synastry mark ("the sky between two people").
export function IconSynastry({ className = "", size = 20 }: { className?: string; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} aria-hidden="true">
      <line x1="7" y1="8" x2="17" y2="16" stroke="currentColor" strokeWidth="1" opacity="0.6" strokeLinecap="round" />
      <g fill="currentColor">
        <path d="M7 3.4 L7.8 6.7 L11 7.5 L7.8 8.3 L7 11.6 L6.2 8.3 L3 7.5 L6.2 6.7 Z" />
        <path d="M17 12.4 L17.8 15.7 L21 16.5 L17.8 17.3 L17 20.6 L16.2 17.3 L13 16.5 L16.2 15.7 Z" />
      </g>
    </svg>
  );
}

export function IconArrowRight({ className = "", size = 16, style }: { className?: string; size?: number; style?: React.CSSProperties }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} style={style} aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12 H19" />
        <path d="M14 6 L20 12 L14 18" />
      </g>
    </svg>
  );
}

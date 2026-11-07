// Small UI primitives. Aesthetic-locked.

import { ReactNode } from "react";

export function Card({
  children,
  className = "",
  as: As = "div",
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "section" | "article";
}) {
  return (
    <As className={`card-paper rounded-sm p-5 sm:p-6 ${className}`}>
      {children}
    </As>
  );
}

export function CardHeading({
  eyebrow,
  title,
  className = "",
}: {
  eyebrow?: string;
  title: string;
  className?: string;
}) {
  return (
    <div className={`mb-4 ${className}`}>
      {eyebrow && (
        <div className="eyebrow mb-1.5">
          {eyebrow}
        </div>
      )}
      <h2 className="display-heading">
        {title}
      </h2>
    </div>
  );
}

// Editorial page header: the oversized display-face moment every route opens
// with. Eyebrow above, giant Fraunces title, aurora thread beneath.
export function PageTitle({
  eyebrow,
  title,
  children,
  className = "",
}: {
  eyebrow?: string;
  title: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <header className={`mb-8 ${className}`}>
      {eyebrow && <div className="eyebrow mb-2">{eyebrow}</div>}
      <h1 className="display-title">{title}</h1>
      {children}
      <div className="rule-aurora mt-5" aria-hidden="true" />
    </header>
  );
}

export function ButtonInk({
  children,
  onClick,
  disabled,
  type = "button",
  className = "",
  href,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit";
  className?: string;
  href?: string;
}) {
  if (href) {
    return (
      <a href={href} className={`btn-ink ${className}`} onClick={onClick as any}>
        {children}
      </a>
    );
  }
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`btn-ink ${className}`}>
      {children}
    </button>
  );
}

export function ButtonGhost({
  children,
  onClick,
  disabled,
  type = "button",
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit";
  className?: string;
}) {
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`btn-ghost ${className}`}>
      {children}
    </button>
  );
}

export function ButtonLink({
  children,
  onClick,
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button type="button" onClick={onClick} className={`btn-link ${className}`}>
      {children}
    </button>
  );
}

export function InlineMessage({
  children,
  variant = "info",
  className = "",
}: {
  children: ReactNode;
  variant?: "info" | "err";
  className?: string;
}) {
  return (
    <div className={`inline-message ${variant === "err" ? "err" : ""} ${className}`}>
      {children}
    </div>
  );
}

export function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label htmlFor={htmlFor} className="block mb-5">
      <span className="field-label">{label}</span>
      {children}
      {hint && (
        <span className="block mt-1.5 text-xs text-[var(--ink-faint)] font-serif italic">
          {hint}
        </span>
      )}
    </label>
  );
}

export function Shimmer({ className = "" }: { className?: string }) {
  return <div className={`ink-shimmer ${className}`} />;
}

// Loading state for the constellation panel: a dark aperture with a few
// breathing stars, so the night sky never flashes in over parchment.
const SKELETON_STARS = [
  { left: "18%", top: "30%", d: "0s" },
  { left: "46%", top: "16%", d: "0.5s" },
  { left: "72%", top: "38%", d: "1.1s" },
  { left: "32%", top: "62%", d: "1.6s" },
  { left: "62%", top: "70%", d: "0.8s" },
  { left: "84%", top: "58%", d: "2s" },
];

export function SkySkeleton({ className = "" }: { className?: string }) {
  return (
    <div className={`sky-skeleton ${className}`} role="status" aria-label="reading the sky">
      {SKELETON_STARS.map((s, i) => (
        <span key={i} className="sk-star" style={{ left: s.left, top: s.top, animationDelay: s.d }} />
      ))}
      <span className="absolute inset-x-0 bottom-3 text-center font-serif italic text-[0.85rem]" style={{ color: "#a08c5c" }}>
        reading the sky…
      </span>
    </div>
  );
}

export function EmptyState({
  asterism,
  lines,
}: {
  asterism: ReactNode;
  lines: string[];
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      {asterism}
      <div className="mt-5 space-y-1 font-serif italic text-[var(--ink-faint)]">
        {lines.map((l, i) => (
          <p key={i}>{l}</p>
        ))}
      </div>
    </div>
  );
}

export function ErrorState({
  asterism,
  lines,
  onRetry,
}: {
  asterism: ReactNode;
  lines: string[];
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center" role="alert">
      {asterism}
      <div className="mt-5 space-y-1 font-serif italic text-[var(--ink-faint)]">
        {lines.map((l, i) => (
          <p key={i}>{l}</p>
        ))}
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="btn-link mt-3"
        >
          try again
        </button>
      )}
    </div>
  );
}

export function Pill({
  children,
  active,
  onClick,
  className = "",
}: {
  children: ReactNode;
  active?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`tab-pill ${active ? "active" : ""} cursor-pointer ${className}`}
    >
      {children}
    </button>
  );
}

export function Avatar({
  initials,
  size = 36,
  ring = false,
}: {
  initials: string;
  size?: number;
  ring?: boolean;
}) {
  return (
    <span
      className="inline-flex items-center justify-center font-serif lowercase select-none"
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: "color-mix(in oklab, var(--parchment-shadow) 70%, transparent)",
        border: `1px solid ${ring ? "var(--gold)" : "rgba(169,138,61,0.45)"}`,
        color: "var(--oxblood-deep)",
        fontSize: size * 0.42,
        letterSpacing: "0.04em",
      }}
      aria-hidden="true"
    >
      {initials}
    </span>
  );
}

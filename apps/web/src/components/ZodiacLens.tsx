// The zodiac lens toggle + the comparison reveal (docs/SIDEREAL.md
// P3). Rendered on every chart-bearing record surface (Chart, HumanDesign,
// GeneKeys). Flipping persists via POST /me/profile and shows "what moved":
// the same birth moment, re-anchored from the seasonal sky to the fixed-star
// sky (or back).
//
// Framing rule (plan section 1 and 4.5): this is a VIEW preference. The copy
// never claims either sky is the true one. When the preference is tropical the
// chart data rendered everywhere is byte-identical to the pre-feature app;
// this strip is the only addition.

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Modal } from "./Modal";
import { Flourish } from "./svg";
import type { HumanDesignResponse, NatalChart, User, ZodiacSystem } from "../lib/types";
import {
  LENS_NEUTRAL_COPY,
  ZODIAC_COPY,
  computeLensShift,
  parseShift,
  serializeShift,
  type LensShift,
  type ShiftItem,
} from "../lib/zodiac";

const SHIFT_KEY = "constellate.lens.shift";

function loadStoredShift(): { shift: LensShift; to: ZodiacSystem } | null {
  try {
    const raw = localStorage.getItem(SHIFT_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw) as { shift?: string; to?: string };
    const shift = parseShift(obj.shift ?? null);
    if (!shift) return null;
    const to: ZodiacSystem = obj.to === "sidereal" ? "sidereal" : "tropical";
    return { shift, to };
  } catch {
    return null;
  }
}

function storeShift(shift: LensShift, to: ZodiacSystem) {
  try {
    localStorage.setItem(SHIFT_KEY, JSON.stringify({ shift: serializeShift(shift), to }));
  } catch {
    /* private mode etc: the reveal simply won't reopen later */
  }
}

async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

type FlipResult = {
  user: User;
  to: ZodiacSystem;
  shift: LensShift | null;
};

export function ZodiacLens() {
  const { user, setUser } = useAuth();
  const qc = useQueryClient();
  const [reveal, setReveal] = useState<{ shift: LensShift; to: ZodiacSystem } | null>(null);
  const [stored, setStored] = useState<{ shift: LensShift; to: ZodiacSystem } | null>(loadStoredShift);

  const current: ZodiacSystem = user?.zodiac_system === "sidereal" ? "sidereal" : "tropical";

  const flip = useMutation<FlipResult, unknown, ZodiacSystem>({
    mutationFn: async (to) => {
      // Capture the frame we are leaving (served under the OLD preference).
      const prevChart = await safe(() =>
        qc.ensureQueryData({ queryKey: ["chart"], queryFn: () => api.getChart() }),
      );
      const prevHd = await safe(() =>
        qc.ensureQueryData<HumanDesignResponse>({ queryKey: ["humandesign"], queryFn: () => api.humandesign() }),
      );

      const nextUser = await api.setZodiacSystem(to);

      // Fetch the frame we arrived in (now served under the NEW preference).
      const nextChart = await safe(() => api.getChart());
      const nextHd = await safe(() => api.humandesign());

      // The shift is always computed tropical-frame vs sidereal-frame, no
      // matter which direction the flip went.
      const from: ZodiacSystem = to === "sidereal" ? "tropical" : "sidereal";
      const chartOf = (z: ZodiacSystem): NatalChart | null =>
        z === to ? nextChart?.chart ?? null : (from === z ? prevChart?.chart ?? null : null);
      const hdOf = (z: ZodiacSystem) =>
        z === to ? nextHd?.hd ?? null : (from === z ? prevHd?.hd ?? null : null);

      const tropChart = chartOf("tropical");
      const sidChart = chartOf("sidereal");
      const shift =
        tropChart || sidChart
          ? computeLensShift(tropChart, sidChart, hdOf("tropical"), hdOf("sidereal"))
          : null;

      // Seed the caches with what we already fetched, then invalidate the rest
      // of the zodiac-dependent surfaces.
      if (nextChart) qc.setQueryData(["chart"], nextChart);
      if (nextHd) qc.setQueryData(["humandesign"], nextHd);
      return { user: nextUser, to, shift };
    },
    onSuccess: (r) => {
      setUser(r.user);
      for (const key of [["chart"], ["humandesign"], ["genekeys"], ["astrocartography"], ["humandesign", "reading"], ["genekeys", "reading"]]) {
        qc.invalidateQueries({ queryKey: key });
      }
      if (r.shift && (r.shift.items.length > 0 || r.shift.hd)) {
        storeShift(r.shift, r.to);
        setStored({ shift: r.shift, to: r.to });
        setReveal({ shift: r.shift, to: r.to });
      }
    },
  });

  if (!user) return null;

  return (
    <div className="mb-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="eyebrow mr-1">the sky you read under</span>
        {(["tropical", "sidereal"] as const).map((z) => {
          const active = current === z;
          return (
            <button
              key={z}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={flip.isPending || active}
              onClick={() => flip.mutate(z)}
              className={`tab-pill ${active ? "active" : ""} ${flip.isPending ? "opacity-60" : "cursor-pointer"}`}
            >
              {flip.isPending && !active ? "re-anchoring…" : `${ZODIAC_COPY[z].name} · ${z === "tropical" ? "seasonal" : "fixed stars"}`}
            </button>
          );
        })}
        {stored && !flip.isPending && (
          <button
            type="button"
            onClick={() => setReveal(stored)}
            className="btn-link text-[0.78rem]"
          >
            what moved
          </button>
        )}
      </div>
      <p className="mt-1.5 font-serif italic text-[0.85rem] text-[var(--ink-faint)]">
        {current === "sidereal"
          ? "you are reading the fixed-star sky. lahiri ayanamsa, whole-sign houses."
          : "you are reading the seasonal sky, the western default."}
      </p>
      {flip.isError && (
        <p className="mt-1 font-serif italic text-[0.85rem]" style={{ color: "var(--oxblood)" }}>
          the sky would not turn just now. try again in a moment.
        </p>
      )}
      {reveal && (
        <LensReveal shift={reveal.shift} to={reveal.to} onClose={() => setReveal(null)} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The comparison reveal: the editorial moment. What moved, what held.
// ---------------------------------------------------------------------------

function ShiftRow({ item, flipped }: { item: ShiftItem; flipped: boolean }) {
  // Display in the direction the user flipped: to sidereal reads tropical →
  // sidereal; back to tropical reads sidereal → tropical.
  const from = flipped ? item.to : item.from;
  const to = flipped ? item.from : item.to;
  return (
    <li className="flex items-baseline gap-3 py-2 border-b border-[rgba(169,138,61,0.18)] last:border-0">
      <span className="eyebrow w-16 shrink-0">{item.label}</span>
      {item.changed ? (
        <span className="font-serif text-[1.08rem] lowercase">
          <span className="text-[var(--ink-faint)]">{from}</span>
          <span className="mx-2 text-[var(--oxblood)]" aria-hidden="true">→</span>
          <span className="text-[var(--oxblood-deep)]">{to}</span>
        </span>
      ) : (
        <span className="font-serif text-[1.08rem] lowercase">
          {to}
          <span className="font-serif italic text-[0.85rem] text-[var(--ink-faint)] ml-2">held its place</span>
        </span>
      )}
    </li>
  );
}

// Exported for tests: the reveal's content, free of the portal-bound Modal so
// it can be server-rendered and asserted against.
export function LensRevealBody({ shift, to }: { shift: LensShift; to: ZodiacSystem }) {
  const toSidereal = to === "sidereal";
  return (
    <div className="space-y-4">
        <p className="font-serif italic text-[0.98rem] leading-relaxed text-[var(--ink-soft)]">
          the signs are the same twelve. the anchor moved. tropical astrology pins the
          wheel to the march equinox, the seasonal sky. sidereal pins it to the stars
          themselves, the fixed-star sky. two thousand years of slow drift set the two
          anchors about twenty-four degrees apart, so most of a chart slides back one
          sign when you re-anchor it.
        </p>
        <p className="font-serif text-[0.92rem] text-[var(--ink-soft)]">
          {toSidereal
            ? <>you are reading the <em style={{ color: "var(--oxblood)" }}>fixed-star sky</em> now, {`measured with the ${shift.ayanamsa} ayanamsa.`}</>
            : <>you are back under the <em style={{ color: "var(--oxblood)" }}>seasonal sky</em>, the western default.</>}
        </p>

        {shift.items.length > 0 && (
          <div>
            <div className="eyebrow mb-1">what moved</div>
            <ul>
              {shift.items.map((it) => (
                <ShiftRow key={it.label} item={it} flipped={!toSidereal} />
              ))}
            </ul>
          </div>
        )}

        {shift.moon_nakshatra && toSidereal && (
          <p className="font-serif italic text-[0.92rem] text-[var(--ink-soft)]">
            the fixed-star sky keeps an older address for the moon: {shift.moon_nakshatra},
            one of the twenty-seven lunar mansions.
          </p>
        )}

        {shift.hd && (
          <div>
            <div className="eyebrow mb-1">your design under this lens</div>
            <ul>
              <ShiftRow item={shift.hd.type} flipped={!toSidereal} />
              <ShiftRow item={shift.hd.profile} flipped={!toSidereal} />
              <ShiftRow item={shift.hd.authority} flipped={!toSidereal} />
            </ul>
            <p className="mt-2 font-serif italic text-[0.85rem] text-[var(--ink-faint)]">
              human design and gene keys were built on the tropical sky, and their authors
              say so plainly. the sidereal design is an alternate lens some practitioners
              explore, not a correction. both readings stay one flip apart.
            </p>
          </div>
        )}

        <div className="flex justify-center"><Flourish /></div>
        <p className="font-serif italic text-[0.85rem] text-[var(--ink-faint)] text-center">
          {LENS_NEUTRAL_COPY}
        </p>
    </div>
  );
}

function LensReveal({
  shift,
  to,
  onClose,
}: {
  shift: LensShift;
  to: ZodiacSystem;
  onClose: () => void;
}) {
  return (
    <Modal title="the sky, re-anchored" onClose={onClose}>
      <LensRevealBody shift={shift} to={to} />
      <button type="button" onClick={onClose} className="btn-ghost w-full mt-4">
        keep reading
      </button>
    </Modal>
  );
}

// A small provenance banner for HD/GK sidereal views: honest about canon,
// never dismissive of the lens.
export function AlternateLensNote({ system }: { system: "humandesign" | "genekeys" }) {
  const founder =
    system === "humandesign"
      ? "ra uru hu built human design on the tropical zodiac and rejected sidereal outright"
      : "richard rudd ties the gene keys' hexagram wheel to the tropical zodiac";
  return (
    <div
      className="mb-5 px-4 py-3 font-serif text-[0.92rem] leading-relaxed"
      style={{
        borderLeft: "2px solid rgba(122,46,42,0.45)",
        background: "rgba(122,46,42,0.05)",
        color: "var(--ink-soft)",
      }}
    >
      <span className="eyebrow block mb-1">alternate lens</span>
      you are reading this under the fixed-star sky. {founder}; the tropical
      reading is this system's canon. the sidereal version is a
      community-explored alternate lens, computed honestly from the same birth
      moment with the lahiri ayanamsa. flip back any time.
    </div>
  );
}

// The mechanical facts between two people, rendered as one editorial section
// inside the pair reading. NOT a five-tab engine dashboard: the engines are
// evidence sources, so this panel reads as "what the instruments found", a few
// quiet rows in the established parchment voice. Everything shown is computed
// by the API's pair layer (lib/pair); no prose model is involved here.

import type { PairMechanics, ConnectionChannelClass } from "../lib/types";

// class -> the one-line house-voice gloss. deliberately non-romantic: the
// romance-coding (or not) belongs to the narrative, which is lens-gated
// server-side. these are instrument words.
const CLASS_GLOSS: Record<ConnectionChannelClass, string> = {
  electromagnetic: "exists only when you are together",
  companionship: "you both carry it, shared ground",
  dominance: "one transmits it whole, the other receives",
  compromise: "one side's full channel overrides the other's half",
};

const CLASS_ORDER: ConnectionChannelClass[] = ["electromagnetic", "compromise", "dominance", "companionship"];

export function PairMechanicsPanel({
  mechanics,
  aName,
  bName,
  meIsA,
}: {
  mechanics: PairMechanics;
  aName: string;
  bName: string;
  meIsA: boolean;
}) {
  const conn = mechanics.connection;
  const gk = mechanics.gene_keys;
  const soc = mechanics.socionics;
  const enn = mechanics.enneagram;
  const youName = meIsA ? aName : bName;
  const themName = meIsA ? bName : aName;
  const sideName = (side: "a" | "b" | null) => (side === "a" ? aName : side === "b" ? bName : "");

  const hasAny =
    (conn && (conn.channels.length > 0 || conn.a_open_defined_by_b.length > 0 || conn.b_open_defined_by_a.length > 0)) ||
    (gk && (gk.programming_partners.length > 0 || gk.shared_keys.length > 0)) ||
    soc || enn;
  if (!hasAny) return null;

  return (
    <div>
      <div className="eyebrow mb-1">the mechanics between you</div>
      <p className="font-serif italic text-[0.92rem] text-[var(--ink-soft)] mb-4">
        computed from the charts, not written by anyone. the reading above puts words to these.
      </p>

      {conn && conn.channels.length > 0 && (
        <section className="mb-5">
          <div className="eyebrow text-[var(--gold-deep)] mb-2">channels you make together</div>
          <ul className="space-y-2">
            {[...conn.channels]
              .sort((x, y) => CLASS_ORDER.indexOf(x.class) - CLASS_ORDER.indexOf(y.class))
              .map((ch) => (
                <li key={ch.key} className="flex flex-col py-1.5 border-b border-[rgba(169,138,61,0.18)] last:border-0">
                  <span className="font-serif text-[1.0rem] lowercase">
                    <span className="text-[var(--oxblood)]">{ch.key}</span>{" "}
                    <span className="text-[var(--ink)]">{ch.name.toLowerCase()}</span>
                    <span className="text-[var(--ink-faint)]"> · {ch.centers.join(" to ").toLowerCase()}</span>
                  </span>
                  <span className="font-serif text-[0.92rem] text-[var(--ink-soft)] lowercase">
                    {ch.class}
                    {ch.dominant ? `, ${sideName(ch.dominant)} carries it whole` : ""}
                    {" — "}
                    {CLASS_GLOSS[ch.class]}
                  </span>
                </li>
              ))}
          </ul>
          {conn.composite_centers.length > 0 && (
            <p className="mt-2 font-serif text-[0.95rem] text-[var(--ink-soft)] lowercase">
              defined only together: {conn.composite_centers.join(", ").toLowerCase()}.
            </p>
          )}
        </section>
      )}

      {conn && (conn.a_open_defined_by_b.length > 0 || conn.b_open_defined_by_a.length > 0) && (
        <section className="mb-5">
          <div className="eyebrow text-[var(--gold-deep)] mb-2">who floods whose openness</div>
          {(meIsA ? conn.a_open_defined_by_b : conn.b_open_defined_by_a).length > 0 && (
            <p className="font-serif text-[0.98rem] text-[var(--ink)] lowercase mb-1">
              {themName} defines {youName}&rsquo;s open{" "}
              {(meIsA ? conn.a_open_defined_by_b : conn.b_open_defined_by_a).join(", ").toLowerCase()}.
              near them, you feel those centers as if they were yours.
            </p>
          )}
          {(meIsA ? conn.b_open_defined_by_a : conn.a_open_defined_by_b).length > 0 && (
            <p className="font-serif text-[0.98rem] text-[var(--ink)] lowercase">
              {youName} defines {themName}&rsquo;s open{" "}
              {(meIsA ? conn.b_open_defined_by_a : conn.a_open_defined_by_b).join(", ").toLowerCase()}.
              your definition fills that space for them.
            </p>
          )}
        </section>
      )}

      {gk && (gk.programming_partners.length > 0 || gk.shared_keys.length > 0) && (
        <section className="mb-5">
          <div className="eyebrow text-[var(--gold-deep)] mb-2">the wheel between you</div>
          <ul className="space-y-2">
            {gk.programming_partners.map((p, i) => (
              <li key={`pp-${i}`} className="font-serif text-[0.98rem] text-[var(--ink)] lowercase">
                programming partners: {aName}&rsquo;s gate {p.a_gate} ({p.a_sphere}) sits directly opposite{" "}
                {bName}&rsquo;s gate {p.b_gate} ({p.b_sphere}). one field, worked from both ends
                {p.a_triad && p.b_triad
                  ? `: ${p.a_triad.gift.toLowerCase()} meeting ${p.b_triad.gift.toLowerCase()}.`
                  : "."}
              </li>
            ))}
            {gk.shared_keys.map((s) => (
              <li key={`sk-${s.gate}`} className="font-serif text-[0.98rem] text-[var(--ink)] lowercase">
                shared key {s.gate}
                {s.triad ? ` (${s.triad.shadow.toLowerCase()} to ${s.triad.gift.toLowerCase()})` : ""}: it sits in{" "}
                {aName}&rsquo;s {s.a_spheres.join(" and ")} and {bName}&rsquo;s {s.b_spheres.join(" and ")}. the same
                spectrum, held twice.
              </li>
            ))}
          </ul>
        </section>
      )}

      {soc && (
        <section className="mb-5">
          <div className="eyebrow text-[var(--gold-deep)] mb-2">intertype</div>
          <p className="font-serif text-[0.98rem] text-[var(--ink)] lowercase">
            {aName} ({soc.a_type}) and {bName} ({soc.b_type}):{" "}
            <span className="text-[var(--oxblood)]">{soc.relation.kind.toLowerCase()}</span>
            {soc.relation.direction
              ? `, ${(soc.relation.direction === "supervisor" || soc.relation.direction === "benefactor" ? aName : bName)} is the ${
                  soc.relation.direction === "supervisor" || soc.relation.direction === "supervisee" ? "supervisor" : "benefactor"
                }`
              : ""}.
          </p>
          <p className="font-serif italic text-[0.92rem] text-[var(--ink-soft)] mt-1">{soc.relation.blurb}</p>
        </section>
      )}

      {enn && (
        <section>
          <div className="eyebrow text-[var(--gold-deep)] mb-2">enneagram contrast</div>
          <p className="font-serif text-[0.98rem] text-[var(--ink)] lowercase">
            {aName} is a {enn.a_wing ?? enn.a_type}, {bName} is a {enn.b_wing ?? enn.b_type}.
            {" "}under stress: {enn.harmonic.same
              ? `both cope the ${enn.harmonic.a} way`
              : `${aName} goes ${enn.harmonic.a}, ${bName} goes ${enn.harmonic.b}`}.
            {" "}stance: {enn.hornevian.same
              ? `both ${enn.hornevian.a}`
              : `${aName} ${enn.hornevian.a}, ${bName} ${enn.hornevian.b}`}.
          </p>
        </section>
      )}
    </div>
  );
}

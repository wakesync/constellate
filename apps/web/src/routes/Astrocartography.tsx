import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { ComposableMap, Geographies, Geography, Graticule } from "react-simple-maps";
import { geoEqualEarth, type GeoProjection } from "d3-geo";
import { Card, CardHeading, Shimmer, EmptyState, Pill } from "../components/ui";
import { Asterism, Flourish } from "../components/svg";
import { api } from "../lib/api";
import { planetColor, planetGlyph } from "../lib/format";
import type { AcgLine, AcgLineKind, Astrocartography } from "../lib/types";
// Bundled landmass silhouette (world-atlas land-110m, ~55kb). No runtime fetch,
// no API key. Renders as a single parchment-toned shape, not a country map.
import landTopo from "../assets/land-110m.json";
import { PrimerButton } from "../components/Primer";

const KINDS: AcgLineKind[] = ["MC", "IC", "ASC", "DSC"];
const KIND_LABEL: Record<AcgLineKind, string> = {
  MC: "midheaven",
  IC: "imum coeli",
  ASC: "ascendant",
  DSC: "descendant",
};
// Solid for the meridian (MC/IC) lines, dashed for the rising/setting curves.
const KIND_DASH: Record<AcgLineKind, string | undefined> = {
  MC: undefined,
  IC: undefined,
  ASC: "5 4",
  DSC: "2 5",
};

// Map dimensions. EqualEarth keeps the antique-globe proportions and avoids the
// stretched poles of a plain equirectangular plate.
const MAP_W = 800;
const MAP_H = 440;

export default function Astrocartography() {
  const q = useQuery({ queryKey: ["astrocartography"], queryFn: () => api.astrocartography() });
  const [activePlanets, setActivePlanets] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<{ planet: string; kind: AcgLineKind } | null>(null);

  // One shared projection instance: passed to ComposableMap AND used to project
  // our own planetary polylines, so lines and land stay pixel-aligned.
  const projection = useMemo<GeoProjection>(
    () => geoEqualEarth().scale(140).translate([MAP_W / 2, MAP_H / 2]),
    [],
  );

  const planets = useMemo(() => {
    if (!q.data) return [];
    const seen: string[] = [];
    for (const l of q.data.lines) if (!seen.includes(l.planet)) seen.push(l.planet);
    return seen;
  }, [q.data]);

  const visibleLines = useMemo(() => {
    if (!q.data) return [];
    if (activePlanets.size === 0) return q.data.lines;
    return q.data.lines.filter((l) => activePlanets.has(l.planet));
  }, [q.data, activePlanets]);

  function togglePlanet(p: string) {
    setActivePlanets((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  }

  const selectedCopy = useMemo(() => {
    if (!selected || !q.data) return null;
    return q.data.interpretations?.[selected.planet]?.[selected.kind] ?? null;
  }, [selected, q.data]);

  return (
    <>
      <motion.header
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="mb-5"
      >
        <div className="eyebrow">
          your record
        </div>
        <h1 className="display-title mt-2">
          lines across the earth
        <PrimerButton primer="astrocartography" /></h1>
        <p className="font-serif italic text-[var(--ink-soft)] mt-1">
          where each planet stood at the angles when you arrived. the map did not place them. it only remembers where they fell.
        </p>
      </motion.header>

      {q.isLoading && (
        <Card>
          <div className="flex flex-col items-center gap-3">
            <Shimmer className="h-56 w-full rounded-sm" />
            <Shimmer className="h-3 w-2/3" />
            <Shimmer className="h-3 w-1/2" />
          </div>
        </Card>
      )}

      {q.data && (
        <>
          <Card className="mb-5 overflow-hidden">
            <div className="acg-map rounded-sm overflow-hidden">
              <ComposableMap
                projection={projection as never}
                width={MAP_W}
                height={MAP_H}
                style={{ width: "100%", height: "auto", display: "block" }}
              >
                <Graticule stroke="rgba(169,138,61,0.18)" strokeWidth={0.4} step={[30, 30]} />
                <Geographies geography={landTopo as never}>
                  {({ geographies }) =>
                    geographies.map((geo) => (
                      <Geography
                        key={geo.rsmKey}
                        geography={geo}
                        fill="rgba(230,220,193,0.85)"
                        stroke="rgba(122,46,42,0.30)"
                        strokeWidth={0.4}
                        style={{
                          default: { outline: "none" },
                          hover: { outline: "none", fill: "rgba(230,220,193,0.85)" },
                          pressed: { outline: "none" },
                        }}
                      />
                    ))
                  }
                </Geographies>

                {visibleLines.map((line, idx) => (
                  <AcgPath
                    key={`${line.planet}-${line.kind}-${idx}`}
                    line={line}
                    projection={projection}
                    selected={selected?.planet === line.planet && selected?.kind === line.kind}
                    dimmed={selected !== null && !(selected.planet === line.planet && selected.kind === line.kind)}
                    onSelect={() => setSelected({ planet: line.planet, kind: line.kind })}
                  />
                ))}
              </ComposableMap>
            </div>

            <div className="mt-3 flex items-center justify-center gap-4 eyebrow">
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block w-5 h-px bg-[var(--ink-soft)]" /> mc · ic
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="inline-block w-5 h-px"
                  style={{ borderTop: "1px dashed var(--ink-soft)" }}
                />{" "}
                asc · dsc
              </span>
            </div>
          </Card>

          <Card className="mb-5">
            <CardHeading eyebrow="the wanderers" title="choose what to follow" />
            <div className="flex flex-wrap gap-2">
              {planets.map((p) => {
                const on = activePlanets.size === 0 || activePlanets.has(p);
                return (
                  <Pill key={p} active={activePlanets.has(p)} onClick={() => togglePlanet(p)}>
                    <span
                      className="inline-block w-2.5 h-2.5 rounded-full"
                      style={{ background: planetColor(p), opacity: on ? 1 : 0.3 }}
                    />
                    <span style={{ color: planetColor(p) }} className="font-serif text-[0.95rem]">
                      {planetGlyph(p)}
                    </span>
                    <span className="lowercase">{p}</span>
                  </Pill>
                );
              })}
            </div>
            {activePlanets.size > 0 && (
              <button
                type="button"
                onClick={() => setActivePlanets(new Set())}
                className="btn-link mt-2"
              >
                show all
              </button>
            )}
          </Card>

          <Card>
            <CardHeading eyebrow="how to read this" title="the four angles" />
            <ul className="space-y-3">
              {KINDS.map((k) => (
                <li key={k} className="flex items-baseline gap-3">
                  <span className="eyebrow w-24 shrink-0">
                    {KIND_LABEL[k]}
                  </span>
                  <span className="font-serif italic text-[var(--ink-soft)] leading-snug">
                    {ANGLE_BLURB[k]}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex justify-center">
              <Flourish />
            </div>
          </Card>
        </>
      )}

      {!q.isLoading && !q.data && (
        <EmptyState
          asterism={<Asterism size={80} />}
          lines={["no lines yet.", "complete onboarding and we'll draw them across the earth."]}
        />
      )}

      {/* interpretation drawer */}
      <AnimatePresence>
        {selected && (
          <InterpretationDrawer
            planet={selected.planet}
            kind={selected.kind}
            copy={selectedCopy}
            onClose={() => setSelected(null)}
          />
        )}
      </AnimatePresence>
    </>
  );
}

const ANGLE_BLURB: Record<AcgLineKind, string> = {
  MC: "where the planet stood highest. it tends to be seen here, in public, in the work.",
  IC: "where the planet stood lowest, out of view. it works on the roots, at home, in private.",
  ASC: "where the planet was rising. it colors how you arrive, the first impression of a place.",
  DSC: "where the planet was setting. it shows up in others, in who you meet and what they reflect.",
};

function AcgPath({
  line,
  projection,
  selected,
  dimmed,
  onSelect,
}: {
  line: AcgLine;
  projection: GeoProjection;
  selected: boolean;
  dimmed: boolean;
  onSelect: () => void;
}) {
  const d = useMemo(() => {
    let path = "";
    let pen = false;
    for (const [lng, lat] of line.coordinates) {
      const pt = projection([lng, lat]);
      if (!pt || Number.isNaN(pt[0]) || Number.isNaN(pt[1])) {
        pen = false;
        continue;
      }
      path += `${pen ? "L" : "M"}${pt[0].toFixed(1)} ${pt[1].toFixed(1)}`;
      pen = true;
    }
    return path;
  }, [line, projection]);

  if (!d) return null;
  const color = planetColor(line.planet);
  const dash = KIND_DASH[line.kind];

  return (
    <g
      onClick={onSelect}
      style={{ cursor: "pointer" }}
      role="button"
      aria-label={`${line.planet} ${line.kind} line`}
    >
      {/* fat invisible hit target for easy tapping on mobile */}
      <path d={d} fill="none" stroke="transparent" strokeWidth={10} />
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={selected ? 2.4 : 1.3}
        strokeDasharray={dash}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={dimmed ? 0.18 : selected ? 1 : 0.82}
      />
    </g>
  );
}

function InterpretationDrawer({
  planet,
  kind,
  copy,
  onClose,
}: {
  planet: string;
  kind: AcgLineKind;
  copy: string | null;
  onClose: () => void;
}) {
  const color = planetColor(planet);
  return (
    <>
      <motion.div
        className="fixed inset-0 z-40 bg-[rgba(31,26,20,0.28)]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      />
      <motion.div
        className="fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-screen-sm safe-bot"
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ type: "spring", stiffness: 320, damping: 34 }}
      >
        <div className="card-paper rounded-t-2xl px-5 pt-5 pb-7 sm:px-7">
          <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-[rgba(169,138,61,0.45)]" />
          <div className="flex items-center gap-3">
            <span
              className="inline-flex items-center justify-center w-9 h-9 rounded-full font-serif text-[1.2rem]"
              style={{ color, border: `1px solid ${color}`, background: "rgba(245,236,217,0.6)" }}
            >
              {planetGlyph(planet)}
            </span>
            <div>
              <div className="font-serif text-[1.3rem] lowercase leading-none">{planet}</div>
              <div className="eyebrow mt-1">
                {KIND_LABEL[kind]} line
              </div>
            </div>
          </div>
          <div className="rule-gold my-4" />
          <p className="font-serif italic text-[1.05rem] text-[var(--ink-soft)] leading-relaxed">
            {copy ?? "no note for this line yet."}
          </p>
          <p className="mt-4 font-serif italic text-[0.85rem] text-[var(--ink-faint)]">
            the chart did not make this happen. it just remembers where it fell.
          </p>
          <button type="button" onClick={onClose} className="btn-ghost w-full mt-5">
            close
          </button>
        </div>
      </motion.div>
    </>
  );
}

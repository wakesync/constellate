// The "i" button: a small circled-i beside each page title that opens a plain
// primer on what the system is, where it comes from, and how to hold it.
// Written in the constellate voice: lowercase, honest about provenance, no glaze.

import { useState } from "react";
import { Modal } from "./Modal";

export type PrimerKey =
  | "chart"
  | "astrocartography"
  | "humandesign"
  | "genekeys"
  | "enneagram"
  | "socionics"
  | "convergence"
  | "synastry"
  | "sky";

type PrimerContent = {
  title: string;
  what: string;
  where: string;
  how: string;
};

const PRIMERS: Record<PrimerKey, PrimerContent> = {
  chart: {
    title: "the natal chart",
    what: "a map of where the sun, moon, and planets stood at the exact minute and place you were born, drawn as a wheel of twelve houses. the big three: your sun is your engine, your moon is your inner weather, your rising is the door you meet the world through.",
    where: "the oldest system here. babylonian sky-watching, refined by hellenistic greece around 2,000 years ago, carried through persia and india and medieval europe to now. the math is real astronomy; the meanings are inherited tradition.",
    how: "not a verdict, a vocabulary. nothing in the chart makes anything happen. it is a very old mirror, useful for noticing patterns you already half-knew and giving them names you can talk about.",
  },
  astrocartography: {
    title: "astrocartography",
    what: "your natal chart projected onto the map of the earth. each planet draws lines across the globe where it would have been rising, setting, or overhead at your birth. places near a line are said to carry that planet's flavor for you.",
    where: "the newest astrology here. formalized in the 1970s from older locational techniques. the geometry is exact; the interpretation is young and loose.",
    how: "best treated as a lens for travel and relocation daydreams. if a city has always pulled at you or repelled you, see what runs through it. do not move for a line. notice, then decide like a person.",
  },
  humandesign: {
    title: "human design",
    what: "a synthesis system that assigns you a type (generator, projector, manifestor, reflector, manifesting generator), an authority (how decisions want to be made in you), and a body graph of defined and open centers. the core claim: you have a correct way of engaging with life, and friction comes from working against it.",
    where: "channeled by the human design founder in 1987 on ibiza, blending the i ching, kabbalah, chakras, and astrology. that is the honest provenance: one man's download, systematized. it is not ancient and not science.",
    how: "hold it as an experiment, which is how the system itself says to hold it. try your strategy and authority for a while and watch what happens. many people find the type descriptions eerily accurate; that alone makes them worth a conversation.",
  },
  genekeys: {
    title: "gene keys",
    what: "64 archetypes, one per hexagram of the i ching, each described as a spectrum from shadow (the fear expression) through gift (the stable talent) to siddhi (the rare flowering). your birth moment picks out a small sequence of keys said to shape your life's work and purpose.",
    where: "written by the gene keys author, a student of the human design lineage, published 2009. it shares human design's math but trades the mechanics for contemplation. more poetry book than instrument panel.",
    how: "the shadow/gift pairs are the useful part: each names a fear pattern and the capacity hiding inside it. read yours slowly, notice which shadow made you flinch, and sit with that one. it is designed for contemplation, not diagnosis.",
  },
  enneagram: {
    title: "the enneagram",
    what: "nine basic patterns of motivation, what you most want, what you most fear, and the strategy you built around it. your type is not your behavior but the engine under it. wings, and lines of growth and stress, describe how the types lean into each other.",
    where: "roots in mystical traditions, drawn into its modern psychological form in the 1960s-70s, then spread through spiritual direction and therapy circles. the typology is unvalidated by research standards but widely used in inner work.",
    how: "the only system here that runs on self-report, so it is only as honest as your answers. the type description should sting a little; if it just flatters you, look again. best used to catch your own strategy in the act.",
  },
  socionics: {
    title: "socionics",
    what: "sixteen types of information metabolism, how a mind takes in and prioritizes the world, described through eight functions arranged in model a. its distinctive claim is intertype relations: that specific pairs of types have predictable chemistry, including your dual, the type said to complete you.",
    where: "developed in 1970s lithuania from psychological typology and information theory. a cousin of mbti but with sharper machinery and a social focus. big in the post-soviet world, niche in the west, unvalidated by mainstream psychology.",
    how: "strongest as a language for friction: why some people effortlessly fill your gaps and others exhaust you for no visible reason. the relation readings between circle members are the point here. hold the labels loosely; watch the dynamics.",
  },
  convergence: {
    title: "convergence",
    what: "not a tradition, a cross-reading. we lay your chart, design, keys, enneagram, and socionics side by side and ask one question: what do these unrelated systems keep saying about you independently? agreement across systems that share no method is the closest thing this house has to a signal.",
    where: "ours. constellate computes each system separately, then reads the overlaps and the contradictions. the contradictions matter as much as the echoes.",
    how: "read it last, after you have met the individual systems. when three unrelated maps mark the same terrain, it is probably worth walking. when they disagree, that tension is usually the interesting part of you.",
  },
  synastry: {
    title: "synastry",
    what: "two natal charts laid over each other. every planet in your chart forms angles (aspects) to every planet in theirs; the tight ones describe how your patterns and their patterns catch, ease, or grind. it is astrology's oldest answer to 'why does this person feel like that.'",
    where: "as old as natal astrology itself, relationship comparison appears in hellenistic and indian tradition both. the aspect math here uses real ephemeris positions for both charts.",
    how: "a synastry reading is about the space between two people, not a score for the people themselves. hard aspects are not bad news; they are where the friction and the growth live. read it together if you can.",
  },
  sky: {
    title: "the sky today",
    what: "the current positions of the planets, read against nothing but themselves: what is meeting what, and what mood that suggests for the day.",
    where: "transit reading, the everyday working tool of astrology in every era. same ephemeris math as your chart, applied to now.",
    how: "as a daily prompt, not a forecast. the sky does what it does whether or not anyone reads it. use it as a reason to notice the day.",
  },
};

function IconInfo({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12 10.8v5.4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="12" cy="7.6" r="1.15" fill="currentColor" />
    </svg>
  );
}

export function PrimerButton({ primer }: { primer: PrimerKey }) {
  const [open, setOpen] = useState(false);
  const p = PRIMERS[primer];
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`what is ${p.title}?`}
        title={`what is ${p.title}?`}
        className="inline-flex items-center justify-center align-middle ml-2 -mt-0.5 w-7 h-7 rounded-full text-[var(--ink-faint)] hover:text-[var(--oxblood)] transition-colors cursor-pointer"
      >
        <IconInfo />
      </button>
      {open && (
        <Modal title={p.title} onClose={() => setOpen(false)}>
          <div className="space-y-4">
            <PrimerSection eyebrow="what it is" body={p.what} />
            <PrimerSection eyebrow="where it comes from" body={p.where} />
            <PrimerSection eyebrow="how to hold it" body={p.how} />
          </div>
        </Modal>
      )}
    </>
  );
}

function PrimerSection({ eyebrow, body }: { eyebrow: string; body: string }) {
  return (
    <div>
      <div className="eyebrow mb-1">
        {eyebrow}
      </div>
      <p className="font-serif text-[0.95rem] leading-relaxed text-[var(--ink-soft)]">
        {body}
      </p>
    </div>
  );
}

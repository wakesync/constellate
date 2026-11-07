// Human Design -> shared trait space.
//
// HD is the most mechanically legible of the five engines: type, authority, and
// which of the nine centers are defined are discrete facts, so we can assign
// honest signs and weights per rule. Every rule is documented in
// docs/CONVERGENCE.md with its rationale.
//
// We read the stored /humandesign payload shape (see the shared HD contract):
//   { type, authority, definition, centers:[{name,defined}], open_centers[],
//     defined_count, profile:{personality_line,design_line} , ... }
//
// Weight philosophy: a DEFINED sacral is a very strong statement about the
// initiation axis (0.9); an open center is a strong statement about sensitivity
// (0.75); type is strong for initiation (0.8). We do NOT stretch HD to speak to
// axes it has no real claim on.

import { makeSignal, type Signal } from "../axes";

type HdCenter = { name: string; defined?: boolean };
type HdPayload = {
  type?: string;
  authority?: string;
  definition?: string;
  centers?: HdCenter[];
  open_centers?: string[];
  defined_count?: number;
  profile?: { personality_line?: number; design_line?: number };
};

function isDefined(hd: HdPayload, name: string): boolean {
  const c = hd.centers?.find((x) => x.name === name);
  if (c) return !!c.defined;
  // fall back to open_centers if centers[] is absent
  if (hd.open_centers) return !hd.open_centers.includes(name);
  return false;
}
function isOpen(hd: HdPayload, name: string): boolean {
  const c = hd.centers?.find((x) => x.name === name);
  if (c) return !c.defined;
  if (hd.open_centers) return hd.open_centers.includes(name);
  return false;
}

export function mapHumanDesign(hd: HdPayload | null | undefined): Signal[] {
  if (!hd) return [];
  const out: (Signal | null)[] = [];
  const S = (axis: string, v: number, w: number, e: string) =>
    out.push(makeSignal("human_design", axis, v, w, e));

  const type = (hd.type ?? "").toLowerCase();

  // --- initiation ---------------------------------------------------------
  // Energy TYPE is HD's headline statement about how you engage.
  //   Manifestor -> initiates (+). Generator/MG -> responds (-). Projector ->
  //   waits to be invited/recognized, so also responsive on initiation (-).
  //   Reflector -> lunar, deeply responsive (-).
  if (type.includes("manifestor") && !type.includes("generator")) {
    S("initiation", 0.9, 0.8, "you are a manifestor, built to initiate. you move first and inform, you do not wait to be asked.");
  } else if (type.includes("generator")) {
    S("initiation", -0.75, 0.85, "you are a generator, built to respond. your energy answers what shows up rather than initiating from cold.");
  } else if (type.includes("projector")) {
    S("initiation", -0.7, 0.7, "you are a projector, built to wait for the invitation. you guide once recognized, you do not push in uninvited.");
  } else if (type.includes("reflector")) {
    S("initiation", -0.8, 0.6, "you are a reflector, moving with the moon's slow cycle. you sample and reflect before anything, never first off the mark.");
  }

  // A DEFINED sacral is the single strongest initiation signal in HD: a sacral
  // being defines a life that answers rather than launches.
  if (isDefined(hd, "Sacral")) {
    S("initiation", -0.7, 0.9, "your sacral is defined, so your energy answers rather than initiates. it lights up in response, not from a standing start.");
    // --- energy ---
    S("energy", 0.85, 0.9, "a defined sacral is a renewable engine. you carry deep, sustainable life force for work you actually love.");
  } else {
    S("energy", -0.7, 0.75, "your sacral is open, so you are not built for relentless output. you run on a store you have to pace and protect.");
  }

  // --- authority_locus ----------------------------------------------------
  // HD authority names the exact locus of the trustworthy yes.
  const auth = (hd.authority ?? "").toLowerCase();
  if (auth.includes("sacral")) {
    S("authority_locus", 0.85, 0.85, "your authority is sacral: the trustworthy signal is a gut response in the body, in the moment, not a thought.");
  } else if (auth.includes("splenic")) {
    S("authority_locus", 0.8, 0.8, "your authority is splenic: a quiet instinctive knowing in the body that speaks once, softly, in the now.");
  } else if (auth.includes("emotional")) {
    // emotional authority => the yes lives in a wave over time, an inner bodily
    // process, so still inner (+), and it directly implies emotional_tempo.
    S("authority_locus", 0.55, 0.7, "your authority is emotional: the yes lives inside you, but it arrives as a wave over time, not a snap answer.");
    S("emotional_tempo", 0.85, 0.85, "with emotional authority your feelings move in waves. clarity comes after the wave passes, never in the heat of the moment.");
  } else if (auth.includes("ego") || auth.includes("heart")) {
    S("authority_locus", 0.5, 0.55, "your authority runs through the will center: you know by what you truly want and are willing to commit to.");
  } else if (auth.includes("self") || auth.includes("projected")) {
    S("authority_locus", -0.3, 0.5, "your authority is self-projected: you hear your truth by speaking it out loud to trusted people, so it lives partly outside you.");
  } else if (auth.includes("mental") || auth.includes("lunar")) {
    S("authority_locus", -0.7, 0.7, "your authority is not inner-fixed: you decide best across time and by talking it through, not from a single gut signal.");
  }

  // A DEFINED solar plexus (emotional center) is the strongest emotional_tempo
  // statement even independent of authority.
  if (isDefined(hd, "Solar Plexus")) {
    S("emotional_tempo", 0.8, 0.85, "your solar plexus is defined: emotion moves through you in waves you generate, and clarity waits for the wave to settle.");
  } else if (isOpen(hd, "Solar Plexus")) {
    S("emotional_tempo", -0.4, 0.55, "your solar plexus is open: you take in and amplify the room's emotional weather, but it moves through rather than swelling from within.");
    S("sensitivity", 0.7, 0.7, "an open solar plexus makes you porous to the emotional weather of a room. much of what you feel there is not yours to keep.");
  }

  // --- sensitivity --------------------------------------------------------
  // Open centers are HD's core statement about porousness. Count them: more open
  // centers, more of the world passes through. Scale weight with how many.
  const openCount = hd.open_centers?.length ?? hd.centers?.filter((c) => !c.defined).length ?? 0;
  if (openCount >= 5) {
    S("sensitivity", 0.8, 0.8, `you carry ${openCount} open centers, so you are deeply porous. the world's pressures pass through you and can feel like your own.`);
  } else if (openCount >= 3) {
    S("sensitivity", 0.45, 0.6, `you have ${openCount} open centers, so you take in a fair amount of the room without a filter.`);
  } else if (openCount <= 1) {
    S("sensitivity", -0.5, 0.55, "very few of your centers are open, so you are more insulated: less of the room's weather lands as your own.");
  }

  // --- conflict -----------------------------------------------------------
  // An open Root or open Spleen speaks to how fear/pressure is handled, but HD's
  // cleanest conflict read is the emotional wave (avoids confronting mid-wave)
  // vs a defined heart/ego (comfortable pressing). Keep weights modest: HD is
  // not primarily a conflict system.
  if (isDefined(hd, "Heart")) {
    S("conflict", 0.4, 0.45, "a defined will center gives you steady standing-your-ground energy; you can hold a line under pressure without straining.");
  }

  // --- structure ----------------------------------------------------------
  // Single/whole definition reads as a consistent, self-contained way of
  // operating (more structured/fixed); splits read as needing others to bridge
  // (more improvisational across the gap). Modest weight.
  const def = (hd.definition ?? "").toLowerCase();
  if (def.includes("single")) {
    S("structure", 0.35, 0.4, "you have single definition: one connected whole, a consistent self-contained way of running that holds its own shape.");
  } else if (def.includes("split")) {
    S("structure", -0.3, 0.4, "you have split definition: parts of you look to others to bridge the gap, which keeps your process more improvisational and open.");
  }

  return out.filter((s): s is Signal => s !== null);
}

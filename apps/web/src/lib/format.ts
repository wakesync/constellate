// Tiny formatters. No deps, no Intl pitfalls.

const SIGN_GLYPH: Record<string, string> = {
  Aries: "♈", Taurus: "♉", Gemini: "♊", Cancer: "♋", Leo: "♌", Virgo: "♍",
  Libra: "♎", Scorpio: "♏", Sagittarius: "♐", Capricorn: "♑", Aquarius: "♒", Pisces: "♓",
};

const PLANET_GLYPH: Record<string, string> = {
  Sun: "☉", Moon: "☽", Mercury: "☿", Venus: "♀", Mars: "♂",
  Jupiter: "♃", Saturn: "♄", Uranus: "♅", Neptune: "♆", Pluto: "♇",
};

export function signGlyph(sign: string): string {
  return SIGN_GLYPH[sign] ?? "·";
}

export function planetGlyph(name: string): string {
  return PLANET_GLYPH[name] ?? "·";
}

// Astrocartography line palette. Warm, ink-and-pigment tones that sit on
// parchment without looking like a modern web map. Keyed by planet name.
const PLANET_COLOR: Record<string, string> = {
  Sun: "#b8860b",     // dark goldenrod
  Moon: "#6b7a8f",    // slate blue-grey
  Mercury: "#8a6d3b", // umber
  Venus: "#9c4f6a",   // dusty rose
  Mars: "#7a2e2a",    // oxblood
  Jupiter: "#5f7d4f", // moss
  Saturn: "#4a3f30",  // ink-soft brown
  Uranus: "#3f6f74",  // teal
  Neptune: "#48557a", // indigo-slate
  Pluto: "#5b3a52",   // plum
};

export function planetColor(name: string): string {
  return PLANET_COLOR[name] ?? "#4a3f30";
}

export function degreeStr(deg: number): string {
  const d = Math.floor(deg);
  const m = Math.floor((deg - d) * 60);
  return `${d}°${m.toString().padStart(2, "0")}′`;
}

export function relTime(ts: number): string {
  const diff = Date.now() - ts;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  if (day < 30) return `${Math.floor(day / 7)}w ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function longDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

export function initialsFor(name: string | null | undefined): string {
  if (!name) return "·";
  const trimmed = name.trim();
  if (!trimmed) return "·";
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toLowerCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toLowerCase();
}

// Locale-friendly current time line, e.g. "tuesday evening, may 27"
export function timeOfDay(d = new Date()): string {
  const hr = d.getHours();
  let span = "morning";
  if (hr >= 12 && hr < 17) span = "afternoon";
  else if (hr >= 17 && hr < 21) span = "evening";
  else if (hr >= 21 || hr < 5) span = "night";
  const weekday = d.toLocaleDateString(undefined, { weekday: "long" }).toLowerCase();
  const md = d.toLocaleDateString(undefined, { month: "long", day: "numeric" }).toLowerCase();
  return `${weekday} ${span}, ${md}`;
}

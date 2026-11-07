import type { Env } from "./types";

export type BirthLike = { date: string; time: string; lat: number; lng: number; tz: string };

// Zodiac frame for every sidecar computation .
// The contract is FIXED: `zodiac` travels in the JSON body of every sidecar
// request; "sidereal" implies the Lahiri ayanamsa unless an explicit ayanamsa
// is ever added. We always send it explicitly (never rely on the sidecar's
// default) so a request is self-describing about which sky it was cast under.
export type Zodiac = "tropical" | "sidereal";

// Astro sidecar can be slow on cold start; bound every call so a hung sidecar
// never holds a Worker request open indefinitely.
const ASTRO_TIMEOUT_MS = 12_000;

export class AstroError extends Error {
  constructor(
    public path: string,
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "AstroError";
  }
}

async function astroFetch<T>(env: Env, path: string, body: unknown): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ASTRO_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${env.ASTRO_URL}${path}`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${env.ASTRO_BEARER}`,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    clearTimeout(timer);
    const reason = err instanceof Error && err.name === "AbortError" ? "timeout" : "network error";
    throw new AstroError(path, 504, `astro ${path} ${reason}`);
  }
  clearTimeout(timer);
  if (!response.ok) {
    throw new AstroError(path, response.status, `astro ${path} failed with ${response.status}`);
  }
  return response.json<T>();
}

export function natalChart(env: Env, body: BirthLike, zodiac: Zodiac = "tropical"): Promise<unknown> {
  return astroFetch(env, "/natal", { ...body, zodiac });
}

export function transitChart(env: Env, body: Omit<BirthLike, "time"> & { date: string }, zodiac: Zodiac = "tropical"): Promise<unknown> {
  return astroFetch(env, "/transits", { ...body, zodiac });
}

export function synastryGrid(env: Env, personA: BirthLike, personB: BirthLike, zodiac: Zodiac = "tropical"): Promise<unknown> {
  return astroFetch(env, "/synastry", { person_a: personA, person_b: personB, zodiac });
}

export type AcgLine = {
  planet: string;
  kind: "MC" | "IC" | "ASC" | "DSC";
  coordinates: [number, number][];
};

export type AcgResult = {
  engine: string;
  generated_at: string;
  input: BirthLike;
  lines: AcgLine[];
  interpretations: Record<string, Record<string, string>>;
};

export function astrocartographyLines(env: Env, body: BirthLike, zodiac: Zodiac = "tropical"): Promise<AcgResult> {
  return astroFetch<AcgResult>(env, "/astrocartography", { ...body, zodiac });
}

// Human Design + Gene Keys. Both take the same birth payload as /natal and
// return the sidecar payloads documented in the shared contract. Deterministic
// for a fixed birth, so callers cache the result in D1.
export function humanDesign(env: Env, body: BirthLike, zodiac: Zodiac = "tropical"): Promise<unknown> {
  return astroFetch(env, "/humandesign", { ...body, zodiac });
}

export function geneKeys(env: Env, body: BirthLike, zodiac: Zodiac = "tropical"): Promise<unknown> {
  return astroFetch(env, "/genekeys", { ...body, zodiac });
}

// Lightweight reachability probe for /healthz. Returns true if the sidecar
// answers its own /healthz within a short budget. Never throws.
export async function astroHealthy(env: Env): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3_000);
  try {
    const res = await fetch(`${env.ASTRO_URL}/healthz`, { signal: controller.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    clearTimeout(timer);
    return false;
  }
}

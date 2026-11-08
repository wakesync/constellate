// Public lane for the full product. Shares the server's router, Darkbloom lane
// and ephemeris-backed transit service rather than a second copy.
import { createPublicLane } from "../../../../server/src/darkbloom";
import { createTransitService } from "../../../../server/src/transits";
import type { Env } from "../types";

type Service = ReturnType<typeof createTransitService>;
let service: Service | null = null;
let boundKey: string | undefined;

/** One cached service per isolate. Rebuilt only if the public-lane config changes. */
export function publicSky(env: Env, opts: { fetch?: typeof fetch; now?: () => number } = {}): Service {
  const key = `${env.DARKBLOOM_API_KEY ?? ""}|${env.DARKBLOOM_MODEL ?? ""}`;
  if (!service || key !== boundKey || opts.fetch || opts.now) {
    const lane = createPublicLane({ fetch: opts.fetch, now: opts.now, config: () => ({ apiKey: env.DARKBLOOM_API_KEY, model: env.DARKBLOOM_MODEL }) });
    const s = createTransitService(lane, opts.now);
    if (opts.fetch || opts.now) return s;
    service = s; boundKey = key;
  }
  return service;
}

// API client. Talks to the real Constellate API.
//
// The mock backend is OPT-IN (VITE_USE_MOCK=1) and used for design/dev only. In
// production it is OFF so auth/IDOR/error states are real, not silently faked.
// (The previous build fell back to mock on ANY 4xx, which masked a broken auth
// wiring and would have shipped a fake-login experience.)

import { startRegistration, startAuthentication } from "@simplewebauthn/browser";
import { mock } from "./mock-api";
import type {
  User,
  BirthData,
  NatalChart,
  Constellation,
  ConstellationMember,
  JournalEntry,
  SkyToday,
  SynastryReport,
  PlaceLookup,
  Astrocartography,
  HumanDesignResponse,
  GeneKeysResponse,
  EnneagramQuestion,
  EnneagramState,
  EnneagramResult,
  SocionicsQuestion,
  SocionicsState,
  SocionicsResult,
  SocionicsRelationResponse,
  ConvergenceResult,
  ElizaMessage,
  ElizaReply,
  PairContext,
  RelationshipKind,
  SynastryGenerationList,
  SynastryGenerationMeta,
  HarmonyPairResponse,
  CircleGraphResponse,
  ZodiacSystem,
} from "./types";

// Bare import.meta.env is statically replaced by Vite at build time exactly
// like the dotted form; the ?? {} fallback only matters under plain node
// (SSR render tests), where import.meta.env is undefined.
const ENV = (import.meta.env ?? {}) as Record<string, string | undefined>;

const API_BASE = ENV.VITE_API_URL ?? "https://api.constellate.me";

const USE_MOCK = ENV.VITE_USE_MOCK === "1";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// Network/offline failures surface as a distinct error so the UI can show the
// "no connection to the sky" copy rather than a generic message.
export class NetworkError extends Error {
  constructor(message = "network") {
    super(message);
    this.name = "NetworkError";
  }
}

type ErrorBody = { error?: string; code?: string };

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API_BASE + path, {
      ...init,
      credentials: "include",
      headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch {
    throw new NetworkError();
  }
  if (!res.ok) {
    let body: ErrorBody = {};
    try {
      body = (await res.json()) as ErrorBody;
    } catch {
      /* non-json error */
    }
    throw new ApiError(res.status, body.code ?? "UNKNOWN", body.error ?? res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// In mock mode, route through the mock client; otherwise hit the real API.
async function maybeMock<T>(real: () => Promise<T>, mockFn: () => Promise<T>): Promise<T> {
  if (USE_MOCK) return mockFn();
  return real();
}

export const api = {
  apiBase: API_BASE,
  usingMock: USE_MOCK,

  async passkeyLogin(email?: string): Promise<User> {
    return maybeMock(
      async () => {
        const begin = await http<{ challenge_id: string; options: Parameters<typeof startAuthentication>[0]["optionsJSON"] }>(
          "/auth/passkey/login/begin",
          { method: "POST", body: JSON.stringify(email ? { email } : {}) },
        );
        const assertion = await startAuthentication({ optionsJSON: begin.options });
        const res = await http<{ ok: boolean; user: User }>("/auth/passkey/login/finish", {
          method: "POST",
          body: JSON.stringify({ challenge_id: begin.challenge_id, response: assertion }),
        });
        return res.user;
      },
      () => mock.passkeyLogin(),
    );
  },

  async passkeyRegister(email: string, displayName?: string): Promise<User> {
    return maybeMock(
      async () => {
        const begin = await http<{ challenge_id: string; options: Parameters<typeof startRegistration>[0]["optionsJSON"] }>(
          "/auth/passkey/register/begin",
          { method: "POST", body: JSON.stringify({ email, display_name: displayName }) },
        );
        const attestation = await startRegistration({ optionsJSON: begin.options });
        const res = await http<{ ok: boolean; user: User }>("/auth/passkey/register/finish", {
          method: "POST",
          body: JSON.stringify({ challenge_id: begin.challenge_id, response: attestation }),
        });
        return res.user;
      },
      () => mock.passkeyRegister(email),
    );
  },

  async logout(): Promise<void> {
    if (USE_MOCK) {
      await mock.logout();
      return;
    }
    try {
      await http("/auth/logout", { method: "POST" });
    } catch {
      /* ignore network errors on logout */
    }
  },

  async me(): Promise<User> {
    return maybeMock(() => http<User>("/me"), () => mock.me());
  },

  async updateProfile(display_name: string): Promise<User> {
    return maybeMock(
      () => http<User>("/me/profile", { method: "POST", body: JSON.stringify({ display_name }) }),
      async () => {
        const u = await mock.me();
        return { ...u, display_name };
      },
    );
  },

  async updatePrivateProfile(fields: { sexual_orientation: string | null; relational_preference: string | null }): Promise<User> {
    return maybeMock(
      () => http<User>("/me/profile", { method: "POST", body: JSON.stringify(fields) }),
      async () => ({ ...(await mock.me()), ...fields }),
    );
  },

  // The zodiac lens preference: which sky charts are read under (tropical =
  // the seasonal sky, sidereal = the fixed-star sky). A VIEW preference; the
  // server keeps both frames' caches side by side, so flipping is instant and
  // never destroys anything.
  async setZodiacSystem(zodiac_system: ZodiacSystem): Promise<User> {
    return maybeMock(
      () => http<User>("/me/profile", { method: "POST", body: JSON.stringify({ zodiac_system }) }),
      async () => ({ ...(await mock.me()), zodiac_system }),
    );
  },

  async saveBirthData(b: BirthData): Promise<void> {
    return maybeMock(
      async () => {
        await http<{ ok: boolean }>("/me/birth-data", { method: "POST", body: JSON.stringify(b) });
      },
      () => mock.saveBirth(b),
    );
  },

  async getChart(): Promise<{ chart: NatalChart; birth: BirthData | null }> {
    return maybeMock(
      async () => {
        const res = await http<{ chart: NatalChart; birth: BirthData | null }>("/me/chart");
        return { chart: res.chart, birth: res.birth ?? null };
      },
      () => mock.getChart(),
    );
  },

  async chartReading(): Promise<{ text: string; reading_mode: "dual_sky" }> {
    return maybeMock(
      () => http<{ text: string; reading_mode: "dual_sky" }>("/me/chart/reading"),
      async () => ({
        text: "the seasonal sky and the fixed-star sky keep pointing at the same person from different doors. where they agree, the signal survives the change of anchor. where they part, the tension belongs to the portrait rather than spoiling it.",
        reading_mode: "dual_sky",
      }),
    );
  },

  async skyToday(): Promise<SkyToday> {
    return maybeMock(() => http<SkyToday>("/sky/today"), () => mock.skyToday());
  },

  async constellations(): Promise<Constellation[]> {
    return maybeMock(() => http<Constellation[]>("/me/constellations"), () => mock.constellations());
  },

  async constellation(id: string): Promise<Constellation | null> {
    return maybeMock(
      async () => {
        try {
          return await http<Constellation>(`/constellations/${encodeURIComponent(id)}`);
        } catch (e) {
          if (e instanceof ApiError && e.status === 404) return null;
          throw e;
        }
      },
      () => mock.constellation(id),
    );
  },

  async constellationMembers(id: string): Promise<ConstellationMember[]> {
    return maybeMock(
      () => http<ConstellationMember[]>(`/constellations/${encodeURIComponent(id)}/members`),
      () => mock.constellationMembers(id),
    );
  },

  async createConstellation(name: string): Promise<Constellation> {
    return maybeMock(
      () => http<Constellation>("/constellations", { method: "POST", body: JSON.stringify({ name }) }),
      () => mock.createConstellation(name),
    );
  },

  async joinConstellation(invite_token: string): Promise<Constellation> {
    return maybeMock(
      () => http<Constellation>("/constellations/join", { method: "POST", body: JSON.stringify({ invite_token }) }),
      () => mock.joinByToken(invite_token),
    );
  },

  async journal(params?: { constellation_id?: string }): Promise<JournalEntry[]> {
    return maybeMock(
      () => {
        const qs = params?.constellation_id ? `?constellation_id=${encodeURIComponent(params.constellation_id)}` : "";
        return http<JournalEntry[]>("/journal" + qs);
      },
      () => mock.journal(params),
    );
  },

  async createJournalEntry(body: string, constellation_id: string | null): Promise<JournalEntry> {
    return maybeMock(
      () => http<JournalEntry>("/journal", { method: "POST", body: JSON.stringify({ body, constellation_id }) }),
      () => mock.createEntry(body, constellation_id),
    );
  },

  // eliza in the circle (lane 0008)
  async elizaMessages(constellation_id: string): Promise<ElizaMessage[]> {
    return maybeMock(
      async () => {
        const r = await http<{ messages: ElizaMessage[] }>(`/constellations/${encodeURIComponent(constellation_id)}/eliza`);
        return r.messages;
      },
      () => mock.elizaMessages(constellation_id),
    );
  },

  async elizaSend(constellation_id: string, body: string): Promise<ElizaReply> {
    return maybeMock(
      () => http<ElizaReply>(`/constellations/${encodeURIComponent(constellation_id)}/eliza`, { method: "POST", body: JSON.stringify({ body }) }),
      () => mock.elizaSend(constellation_id, body),
    );
  },

  async synastry(other_user_id: string, generation?: string): Promise<SynastryReport> {
    // GET only. Never auto-generates: a 404 SYNASTRY_NOT_FOUND surfaces as the
    // "cast the first reading" empty state, and casting is an explicit act.
    const suffix = generation ? `?generation=${encodeURIComponent(generation)}` : "";
    return maybeMock(
      () => http<SynastryReport>(`/synastry/${encodeURIComponent(other_user_id)}${suffix}`),
      () => mock.synastry(other_user_id),
    );
  },

  async regenerateSynastry(other_user_id: string): Promise<SynastryReport> {
    return maybeMock(
      () => http<SynastryReport>(`/synastry/${encodeURIComponent(other_user_id)}`, { method: "POST" }),
      () => mock.synastry(other_user_id),
    );
  },

  async synastryGenerations(other_user_id: string): Promise<SynastryGenerationList> {
    return maybeMock(
      () => http<SynastryGenerationList>(`/synastry/${encodeURIComponent(other_user_id)}/generations`),
      async () => ({ generations: [], total: 0, current_lens: "unspecified" as const }),
    );
  },

  async setSynastryActive(other_user_id: string, generation_id: string): Promise<{ generation: SynastryGenerationMeta }> {
    return maybeMock(
      () => http<{ generation: SynastryGenerationMeta }>(`/synastry/${encodeURIComponent(other_user_id)}/active`, {
        method: "PUT",
        body: JSON.stringify({ generation_id }),
      }),
      async () => { throw new ApiError(404, "SYNASTRY_NOT_FOUND", "no reading yet. ask for one."); },
    );
  },

  async pairContext(other_user_id: string): Promise<PairContext> {
    return maybeMock(
      () => http<PairContext>(`/pairs/${encodeURIComponent(other_user_id)}/context`),
      async () => ({ relationship: null, set_by: null, updated_at: null }),
    );
  },

  async setPairContext(other_user_id: string, relationship: RelationshipKind): Promise<PairContext> {
    return maybeMock(
      () => http<PairContext>(`/pairs/${encodeURIComponent(other_user_id)}/context`, {
        method: "PUT",
        body: JSON.stringify({ relationship }),
      }),
      async () => ({ relationship, set_by: null, updated_at: Math.floor(Date.now() / 1000) }),
    );
  },

  async astrocartography(): Promise<Astrocartography> {
    return maybeMock(
      () => http<Astrocartography>("/me/astrocartography"),
      () => mock.astrocartography(),
    );
  },

  async placesLookup(q: string): Promise<PlaceLookup[]> {
    return maybeMock(
      () => http<PlaceLookup[]>("/places/lookup", { method: "POST", body: JSON.stringify({ q }) }),
      () => mock.placesLookup(q),
    );
  },

  // ---- Human Design --------------------------------------------------------

  async humandesign(): Promise<HumanDesignResponse> {
    return maybeMock(
      () => http<HumanDesignResponse>("/me/humandesign"),
      () => mock.humandesign(),
    );
  },

  async humandesignReading(): Promise<{ text: string }> {
    return maybeMock(
      () => http<{ text: string }>("/me/humandesign/reading"),
      () => mock.hdReading(),
    );
  },

  // ---- Gene Keys -----------------------------------------------------------

  async genekeys(): Promise<GeneKeysResponse> {
    return maybeMock(
      () => http<GeneKeysResponse>("/me/genekeys"),
      () => mock.genekeys(),
    );
  },

  async genekeysReading(): Promise<{ text: string }> {
    return maybeMock(
      () => http<{ text: string }>("/me/genekeys/reading"),
      () => mock.gkReading(),
    );
  },

  // ---- Enneagram -----------------------------------------------------------

  async enneagramQuestions(): Promise<{ questions: EnneagramQuestion[] }> {
    return maybeMock(
      () => http<{ questions: EnneagramQuestion[] }>("/enneagram/questions"),
      () => mock.enneagramQuestions(),
    );
  },

  async enneagramState(): Promise<EnneagramState> {
    return maybeMock(
      () => http<EnneagramState>("/me/enneagram"),
      () => mock.enneagramState(),
    );
  },

  // Save partial (or complete) answers. When the set completes, the server
  // returns the scored result; otherwise result stays null.
  async enneagramSave(answers: Record<string, number>): Promise<EnneagramState> {
    return maybeMock(
      async () => {
        const res = await http<{ result: EnneagramResult | null; answered?: number; total?: number }>(
          "/me/enneagram",
          { method: "POST", body: JSON.stringify({ answers }) },
        );
        // The contract's POST returns { result }. Fold in counts if present,
        // otherwise re-read state so the UI progress stays honest.
        if (typeof res.answered === "number" && typeof res.total === "number") {
          return { result: res.result, answered: res.answered, total: res.total };
        }
        const st = await http<EnneagramState>("/me/enneagram");
        return { result: res.result ?? st.result, answered: st.answered, total: st.total };
      },
      () => mock.enneagramSave(answers),
    );
  },

  async enneagramReset(): Promise<void> {
    return maybeMock(
      async () => {
        await http("/me/enneagram", { method: "DELETE" });
      },
      () => mock.enneagramReset(),
    );
  },

  async enneagramReading(): Promise<{ text: string }> {
    return maybeMock(
      () => http<{ text: string }>("/me/enneagram/reading"),
      () => mock.enneagramReading(),
    );
  },

  // ---- Socionics -----------------------------------------------------------

  async socionicsQuestions(): Promise<{ questions: SocionicsQuestion[] }> {
    return maybeMock(
      () => http<{ questions: SocionicsQuestion[] }>("/socionics/questions"),
      () => mock.socionicsQuestions(),
    );
  },

  async socionicsState(): Promise<SocionicsState> {
    return maybeMock(
      () => http<SocionicsState>("/me/socionics"),
      () => mock.socionicsState(),
    );
  },

  async socionicsSave(answers: Record<string, number>): Promise<SocionicsState> {
    return maybeMock(
      async () => {
        const res = await http<{ result: SocionicsResult | null; answered?: number; total?: number }>(
          "/me/socionics",
          { method: "POST", body: JSON.stringify({ answers }) },
        );
        if (typeof res.answered === "number" && typeof res.total === "number") {
          return { result: res.result, answered: res.answered, total: res.total };
        }
        const st = await http<SocionicsState>("/me/socionics");
        return { result: res.result ?? st.result, answered: st.answered, total: st.total };
      },
      () => mock.socionicsSave(answers),
    );
  },

  async socionicsReset(): Promise<void> {
    return maybeMock(
      async () => {
        await http("/me/socionics", { method: "DELETE" });
      },
      () => mock.socionicsReset(),
    );
  },

  async socionicsReading(): Promise<{ text: string }> {
    return maybeMock(
      () => http<{ text: string }>("/me/socionics/reading"),
      () => mock.socionicsReading(),
    );
  },

  async socionicsRelation(other_user_id: string): Promise<SocionicsRelationResponse> {
    return maybeMock(
      () => http<SocionicsRelationResponse>(`/socionics/relations/${encodeURIComponent(other_user_id)}`),
      () => mock.socionicsRelation(other_user_id),
    );
  },

  // ---- Convergence ---------------------------------------------------------

  async convergence(): Promise<ConvergenceResult> {
    return maybeMock(
      () => http<ConvergenceResult>("/me/convergence"),
      () => mock.convergence(),
    );
  },

  async convergenceReading(): Promise<{ text: string }> {
    return maybeMock(
      () => http<{ text: string }>("/me/convergence/reading"),
      () => mock.convergenceReading(),
    );
  },

  async pairConvergence(other_user_id: string, regenerate = false): Promise<{ narrative: string; relationship_context: RelationshipKind | "unspecified"; degraded: boolean }> {
    return http(`/convergence/pair/${encodeURIComponent(other_user_id)}`, regenerate ? { method: "POST" } : undefined);
  },

  // ---- Harmony + circle graph ----------------------------------------------

  async harmonyPair(other_user_id: string): Promise<HarmonyPairResponse> {
    return maybeMock(
      () => http<HarmonyPairResponse>(`/harmony/pair/${encodeURIComponent(other_user_id)}`),
      () => mock.harmonyPair(other_user_id),
    );
  },

  async circleGraph(constellation_id: string): Promise<CircleGraphResponse> {
    return maybeMock(
      () => http<CircleGraphResponse>(`/constellations/${encodeURIComponent(constellation_id)}/graph`),
      () => mock.circleGraph(constellation_id),
    );
  },
};

// Map an unknown error to user-facing copy in the constellate voice.
export function errorCopy(e: unknown): string {
  if (e instanceof NetworkError) return "no connection to the sky. the chart will wait.";
  if (e instanceof ApiError) {
    if (e.status === 401) return "sign in to see this.";
    if (e.status === 403) return "this is not yours to read.";
    if (e.status === 404) return "nothing here by that name.";
    if (e.status === 429) return "too many requests in a short time. the sky asks for a pause.";
    if (e.status >= 500) return "the reading is unavailable right now. it is not your fault. try again shortly.";
    return e.message || "something did not arrive. try again in a moment.";
  }
  return "something did not arrive. try again in a moment.";
}

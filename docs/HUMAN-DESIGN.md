# Human Design + Gene Keys + Enneagram — mechanics, sources, verification

Backend lane. Surface: `services/astro/**` (hd.py, main.py, test_hd.py) and `apps/api/**`
(routes, migration 0005, sidecar client, prompts, enneagram instrument). The frontend lane owns
`apps/web/**` and builds against the shared contract in `/tmp/constellate-hd-CONTRACT.md`.

Human Design is **mechanical**. A wrong gate, a wrong channel, a wrong type is instantly spotted by
anyone who uses the system. Every hard part below is derived from a cited source and cross-checked
against at least two independently published public charts.

---

## 1. The two charts + the 88-degree design solver

- **Personality** chart = the exact birth moment.
- **Design** chart = the moment the Sun's ecliptic longitude was exactly **88.000 degrees LESS**
  than its natal longitude (mod 360). This is ~88 to 89 calendar days before birth but the Sun's
  apparent speed is not uniform (Earth's elliptical orbit), so the "88 days" shortcut is WRONG.

We solve it iteratively (`hd.design_time_jd`) by **bisection on the solar arc**: bracket 86..92 days
before birth, bisect until `natal_sun_lon - design_sun_lon == 88.0 deg` to well under an arcsecond.

**Source:** the 88-degree solar arc is the canonical Design-date definition across the Jovian
Archive lineage and every HD reference. Confirmed via web research (e.g. jovianarchive.com,
puregenerators.com, christieinge.com "conscious vs unconscious"). The distinction from "88 days" is
explicitly noted in those sources.

**Verification (test_hd.py):** for the smoke birth 1999-12-25 14:30 Hyderabad, the solver returns a
design moment **87.6803 days** before birth with a solar arc of **exactly 88.000000 deg** (error <
0.0000 arcsec). This proves it is a true solar-arc solve, not a day count.

## 2. Planets — 13 per chart, 26 activations

Order (both charts): Sun, Earth, North Node, South Node, Moon, Mercury, Venus, Mars, Jupiter,
Saturn, Uranus, Neptune, Pluto.
- **Earth** = Sun longitude + 180 (mod 360).
- **South Node** = North Node + 180 (mod 360).
- We use `swe.TRUE_NODE` (the true node), which is what standard HD software uses.

Ephemeris: `swe.FLG_MOSEPH | swe.FLG_SPEED` (Moshier analytical), matching the existing sidecar. No
data files, arcsecond accuracy over the supported range.

## 3. The gate wheel — order + offset

The 64 I Ching gates map onto the 360-degree ecliptic in the **Rave mandala order**, NOT numeric
1..64 order. The ring **begins with Gate 41 at exactly 02 deg 00' 00" Aquarius** (= 302.0 deg
absolute ecliptic longitude). Each gate spans 360/64 = **5.625 deg**; each of its 6 lines spans
0.9375 deg; lines subdivide into color/tone/base (6 each).

**Full ordered wheel constant** lives in `services/astro/hd.py` as `GATE_WHEEL` (64 entries), with
a comment citing the sources.

**Sources (two independent):**
1. `bonniesorsby.com/human-design-gates-by-degree` — a full **by-degree table** giving every gate's
   start/end degree. We fetched it and walked it sign by sign from 2 deg Aquarius forward to
   reconstruct the ring. Gate 41 = 2 deg Aquarius confirmed here.
2. The widely published "Rave mandala" gate sequence (Jovian Archive lineage), cross-referenced from
   multiple HD sites (christieinge.com, wholeandunleashed.com, ahumandesign.com).

**Note on a discrepancy we caught:** one AI-summarized sequence dropped six gates (1, 43, 14, 34, 9,
5) in the Scorpio->Sagittarius stretch. We did NOT trust it. The bonniesorsby by-degree table is the
authoritative source we reconstructed from, and it includes all 64. The `assert len == 64` and
`assert unique` in hd.py guard against exactly this class of error, and both pass.

## 4. Channels + centers

- **9 centers**, fixed output order: Head, Ajna, Throat, G, Heart, Sacral, Solar Plexus, Spleen,
  Root.
- **36 channels**, each connecting exactly 2 centers via 2 gates. Encoded in `hd.CHANNELS`; we
  canonicalize by `frozenset(gate_pair)` into `CANON_CHANNELS` (asserts == 36).
- A center is **DEFINED** iff at least one channel touching it is **fully activated** (both its
  gates activated by any planet in either chart).

**Source:** the canonical Human Design 36-channel table (Jovian Archive lineage), the standard
BodyGraph. The channel set was verified indirectly but strongly by the known-chart tests below:
deriving the correct type, authority, definition, and incarnation cross for two different public
charts is only possible if the channel/center wiring is correct.

## 5. Type, authority, profile, definition, cross

- **Type** is computed on the **graph of DEFINED channels** (real BFS connectivity, not a lookup):
  - no centers defined -> **Reflector**
  - Sacral defined + a motor connected to Throat -> **Manifesting Generator**; Sacral defined
    without -> **Generator**
  - Sacral undefined + a motor (Heart, Solar Plexus, Root, Sacral) connected to Throat ->
    **Manifestor**
  - Sacral undefined + no motor-to-Throat -> **Projector**
- **Authority** by strict precedence: Solar Plexus -> Emotional; else Sacral -> Sacral; else Spleen
  -> Splenic; else Heart -> Ego; else G -> Self-Projected; else (Head/Ajna/Throat only) ->
  Mental; Reflector -> Lunar.
- **Profile** = personality Sun line / design Sun line, with the traditional pair name.
- **Definition** = count of connected components among defined centers (None/Single/Split/Triple
  Split/Quadruple Split).
- **Incarnation cross** = personality Sun/Earth + design Sun/Earth gates, with angle
  (Right/Left/Juxtaposition) from the profile line pair.

## 6. Gene Keys

Built on the same gate/line activations. The Activation Sequence spheres:
- **Life's Work** = personality Sun, **Evolution** = personality Earth, **Radiance** = design Sun,
  **Purpose** = design Earth.
- Each key carries its **Shadow / Gift / Siddhi** triad (`hd.GENE_KEYS`, all 64).

**Source:** the published Gene Keys transmission (Richard Rudd). The full 64-entry Shadow/Gift/Siddhi
table was taken from a published compilation (thesaturnway.com "unlocking the gene key archetypes")
and encoded verbatim, with minor spelling normalized to Rudd's canonical terms where the compilation
and the official transmission differ (British spellings, e.g. "Honour", "Valour").

---

## Verification results

Run: `cd services/astro && ./.venv/bin/python test_hd.py`

**23/23 checks pass.** Two independently published public charts, both correct on every derived
field:

### Ra Uru Hu — founder of Human Design (April 9 1948, 00:05, Montreal / America/Toronto)
Published: **Manifestor, 5/1, Splenic authority, Left Angle Cross of The Clarion (51/57 | 61/62)**.
Derived: type=**Manifestor**, authority=**Splenic**, profile=**5/1**, definition=Single, cross
gates=**[51, 57, 61, 62]**, angle=**Left Angle**. Match.
(Our cross label prints gates as `(51/61 | 57/62)` = personality-sun/design-sun | personality-earth/
design-earth grouping; the published "51/57 | 61/62" is the sun-pair/earth-pair grouping. Same four
gates, different display grouping only. The `gates` array in the payload is the source of truth.)

### Albert Einstein (March 14 1879, 11:30, Ulm / Europe/Berlin)
Published: **Generator, Emotional authority, 1/4, Split definition, Right Angle Cross of Eden
(36/6 | 11/12)**.
Derived: type=**Generator**, authority=**Emotional**, profile=**1/4**, definition=**Split**, cross
gates=**[36, 6, 11, 12]**. Match.

### Mechanical checks
- gate wheel: 64 unique entries, starts at gate 41, gate-41 midpoint maps to 41, degree just before
  302 maps to gate 60 (wrap correct).
- 36 canonical channels.
- 88-degree solver: arc = exactly 88.000000 deg (err < 0.0000 arcsec), 87.68 days before birth
  (correctly NOT 88 days).

### Sidecar endpoint smoke (contract test birth 1999-12-25 14:30 Hyderabad)
`/humandesign`, `/genekeys`, `/astro/design-time` all return well-formed payloads matching the
contract shapes. type=Projector, authority=Emotional, profile=6/2, design datetime 1999-09-28
16:40:20Z.

---

## What I could NOT verify (be loud about this)

1. **Gene Keys codon rings.** The 21 codon rings group the 64 keys into biochemical families. I did
   NOT find a single authoritative machine-readable mapping I trusted for all 64, so `codon_ring` is
   returned as **null** for every key rather than guessed. The contract's example showed a
   `codon_ring` field; it is present but null pending a verified 21-ring table.
2. **Venus Sequence and Pearl Sequence spheres.** These require additional sphere->planet/derivation
   mappings (e.g. which planet drives each Venus sphere, and the sequencing rules) that I could not
   verify against a primary source with confidence. Per the contract, I **omit** them (`venus:
   null`, `pearl: null`) rather than invent the mapping. Only the four Activation Sequence spheres
   (Life's Work / Evolution / Radiance / Purpose) are shipped, and those are unambiguous.
3. **A few Gift/Siddhi word choices** vary slightly between Gene Keys editions/compilers (e.g.
   Key 45 Gift "Synergy" vs "Communion"; Key 22 Siddhi "Grace" vs "Revelation"). I used the values
   from the cited compilation and normalized spelling. These are cosmetic labels, not mechanics, but
   flagging that a purist might prefer a different edition's wording.
4. **Channel table was verified indirectly**, not against a machine-readable Jovian Archive export.
   The two known-chart derivations (type/authority/definition/cross all correct on both) give strong
   confidence the full 36-channel wiring is right, but if a future bug surfaces on an unusual chart,
   the channel table (`hd.CHANNELS`) is the first place to audit against an official BodyGraph.
5. **Enneagram** is a self-report screening instrument I authored (54 balanced items, 6 per type),
   not a validated psychometric. It is honest about ties and never claims to be an RHETI-grade test.
   Instinctual subtype (sp/so/sx) is NOT measured, so `instinct` is always null.

### Sources
- 88-degree design date: jovianarchive.com, puregenerators.com, christieinge.com (research 2026-07-25)
- gate wheel order + 2 Aquarius offset: bonniesorsby.com/human-design-gates-by-degree (fetched),
  cross-checked against christieinge.com / wholeandunleashed.com / ahumandesign.com
- 36 channels + centers + type/authority rules: standard Human Design BodyGraph (Jovian Archive
  lineage), verified via the Ra Uru Hu + Einstein known-chart derivations
- Gene Keys Shadow/Gift/Siddhi: Richard Rudd's transmission, table via
  thesaturnway.com/blog "unlocking the gene key archetypes"
- known charts: Ra Uru Hu (jovianarchive.com, mybodygraph.com), Einstein
  (flowwithhumandesign.com, geneticmatrix.com)

---

## DEPLOY-NOTES (orchestrator runs these AFTER Shadow says go — DO NOT run them here)

Nothing below was executed by this lane. No deploy, no remote migration, no service restart happened.

1. **Apply migration 0005 to D1** (local first to sanity-check, then remote):
   ```
   cd apps/api
   npx wrangler d1 migrations apply constellate-prod --local     # dry sanity
   npx wrangler d1 migrations apply constellate-prod --remote     # production
   ```
   Note: a `0006_socionics.sql` from another lane also exists; `migrations apply` runs all pending in
   order. Confirm both are intended before applying remote.

2. **Restart the astro sidecar** (picks up hd.py + the new endpoints):
   ```
   sudo systemctl restart constellate-astro.service
   systemctl status constellate-astro.service --no-pager
   curl -s https://astro.constellate.me/healthz
   ```
   (hd.py imports cleanly and main.py registers /humandesign, /genekeys, /astro/design-time —
   verified locally.)

3. **Deploy the API worker:**
   ```
   cd apps/api
   npx wrangler deploy
   ```

4. **Smoke test after deploy** (needs a logged-in session cookie):
   ```
   curl -s https://api.constellate.me/me/humandesign  --cookie "session=..."
   curl -s https://api.constellate.me/me/genekeys      --cookie "session=..."
   curl -s https://api.constellate.me/enneagram/questions --cookie "session=..."
   ```

Pre-deploy status: API `npm run typecheck` passes clean. Sidecar `test_hd.py` 23/23 pass.
Migration 0005 applies cleanly in a 0001->0005 SQLite chain. No secrets committed.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeSynastryNarrative } from "../src/lib/synastry-format";

let checks = 0;
function ok(condition: boolean, message: string): void {
  checks++;
  if (!condition) throw new Error(message);
}

const here = dirname(fileURLToPath(import.meta.url));
const sample = readFileSync(join(here, "fixtures", "synastry-truncated-sample.txt"), "utf8");
const normalized = normalizeSynastryNarrative(sample);
ok(!normalized.trimStart().startsWith("{"), "prod fail-before fixture never crosses the API as raw JSON");
ok(normalized.includes("cast under the sidereal fixed-star sky"), "opening is preserved");
ok(normalized.includes("*sharing a roof*"), "all complete editorial sections are preserved");
ok(normalized.includes("*the shape of it*"), "complete verdict is preserved");
ok(normalized.includes("ada's Venus trine bram's Moon:"), "complete highlights are preserved");
ok(!normalized.includes('"opening"') && !normalized.includes('"sections"'), "transport keys do not leak into prose");
ok(!normalized.includes("small talk keeps"), "unfinished final highlight is omitted instead of displayed as a fragment");

const valid = '```json\n{"opening":"one image.","sections":[{"title":"the recognition","body":"a complete thought."}],"verdict":"the honest shape.","highlights":[{"aspect":"sun trine moon","meaning":"they recognize each other"}]}\n```';
const validOut = normalizeSynastryNarrative(valid);
ok(validOut === "one image.\n\n*the recognition*\na complete thought.\n\n*the shape of it*\nthe honest shape.\n\n*the aspects that matter*\nsun trine moon: they recognize each other", "fenced valid JSON renders deterministically");

const prose = "old flowing prose\n\nstays byte-for-byte intact.";
ok(normalizeSynastryNarrative(prose) === prose, "legacy prose is preserved byte-for-byte");

const unknown = "a brace in prose { does not become transport json";
ok(normalizeSynastryNarrative(unknown) === unknown, "unrecognized brace-bearing prose is preserved");

console.log(`${checks} synastry-format checks passed`);

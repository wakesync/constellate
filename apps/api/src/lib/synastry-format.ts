// Synastry narratives cross an API boundary as editorial prose, never as model
// transport JSON. Existing prose is preserved byte-for-byte. Structured JSON
// (including fenced/wrapped JSON) is rendered deterministically. If the model
// was cut off mid-JSON, complete fields are salvaged without mutating the
// append-only generation row; an unfinished final array item is omitted.

type Section = { title?: unknown; body?: unknown };
type Highlight = { aspect?: unknown; meaning?: unknown };
type StructuredReading = {
  opening?: unknown;
  sections?: unknown;
  verdict?: unknown;
  highlights?: unknown;
};

type Parsed = { value: StructuredReading; repaired: boolean; dropLastArrayItem: boolean };

function repairTruncatedJson(source: string): { text: string; dropLastArrayItem: boolean } | null {
  const start = source.indexOf("{");
  if (start === -1) return null;
  const input = source.slice(start).replace(/\s*```(?:json)?\s*$/i, "").trimEnd();
  const stack: Array<{ closer: "}" | "]"; start: number }> = [];
  let inString = false;
  let escaped = false;
  let stringStart = -1;
  let last = input.length;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; stringStart = i; }
    else if (ch === "{") stack.push({ closer: "}", start: i });
    else if (ch === "[") stack.push({ closer: "]", start: i });
    else if (ch === "}" || ch === "]") {
      if (stack.at(-1)?.closer !== ch) {
        last = i;
        break;
      }
      stack.pop();
    }
  }

  if (!stack.length && !inString) return null;
  const hadOpenArrayItem = stack.length >= 2 && stack.at(-1)?.closer === "}" && stack.some((x) => x.closer === "]");
  let repaired = input.slice(0, last).trimEnd();
  if (inString) {
    const beforeString = input.slice(0, stringStart).trimEnd().at(-1);
    // If truncation occurred inside an object key, that object has no usable
    // field. Remove the unfinished object, then close its parent array.
    if ((beforeString === "{" || beforeString === ",") && stack.at(-1)?.closer === "}") {
      repaired = input.slice(0, stack.at(-1)!.start).trimEnd();
      stack.pop();
    } else {
      repaired += '"';
    }
  }
  // A cut can occur after a complete value but before a comma/property. Remove
  // only dangling syntax, never content inside a string.
  repaired = repaired.replace(/,\s*$/, "");
  for (let i = stack.length - 1; i >= 0; i--) repaired += stack[i].closer;
  return { text: repaired, dropLastArrayItem: hadOpenArrayItem };
}

function structured(value: unknown): value is StructuredReading {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as StructuredReading;
  return typeof v.opening === "string" || Array.isArray(v.sections) || typeof v.verdict === "string";
}

function parseStructured(source: string): Parsed | null {
  const trimmed = source.trim();
  if (!trimmed.includes("{")) return null;
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (end > start) {
    try {
      const value = JSON.parse(trimmed.slice(start, end + 1));
      if (structured(value)) return { value, repaired: false, dropLastArrayItem: false };
    } catch {
      // Fall through to bounded truncated-output repair.
    }
  }
  const repaired = repairTruncatedJson(trimmed);
  if (!repaired) return null;
  try {
    const value = JSON.parse(repaired.text);
    if (structured(value)) return { value, repaired: true, dropLastArrayItem: repaired.dropLastArrayItem };
  } catch {
    // Preserve unknown prose-like payloads exactly rather than guessing.
  }
  return null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function normalizeSynastryNarrative(source: string): string {
  const parsed = parseStructured(source);
  if (!parsed) return source;
  const reading = parsed.value;
  const paragraphs: string[] = [];
  const opening = text(reading.opening);
  if (opening) paragraphs.push(opening);

  if (Array.isArray(reading.sections)) {
    for (const raw of reading.sections as Section[]) {
      if (!raw || typeof raw !== "object") continue;
      const title = text(raw.title);
      const body = text(raw.body);
      if (title && body) paragraphs.push(`*${title}*\n${body}`);
    }
  }

  const verdict = text(reading.verdict);
  if (verdict) paragraphs.push(`*the shape of it*\n${verdict}`);

  if (Array.isArray(reading.highlights)) {
    let highlights = reading.highlights as Highlight[];
    if (parsed.repaired && parsed.dropLastArrayItem && highlights.length) highlights = highlights.slice(0, -1);
    const lines = highlights.flatMap((raw) => {
      if (!raw || typeof raw !== "object") return [];
      const aspect = text(raw.aspect);
      const meaning = text(raw.meaning);
      return aspect && meaning ? [`${aspect}: ${meaning}`] : [];
    });
    if (lines.length) paragraphs.push(`*the aspects that matter*\n${lines.join("\n")}`);
  }

  // A recognized object with no usable content should remain inspectable.
  return paragraphs.length ? paragraphs.join("\n\n") : source;
}

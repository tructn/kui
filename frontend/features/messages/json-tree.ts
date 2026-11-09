export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonContainer = JsonValue[] | { [key: string]: JsonValue };

/** How many times a string may be JSON-encoded inside itself and still be unwrapped. */
const MAX_STRING_LAYERS = 4;

export function isContainer(value: JsonValue): value is JsonContainer {
  return typeof value === "object" && value !== null;
}

/** `text` parsed as JSON, or undefined if it isn't. */
export function parseJson(text: string): JsonValue | undefined {
  try {
    return JSON.parse(text) as JsonValue;
  } catch {
    return undefined;
  }
}

/** What a string turned out to hold: JSON, JSON that is broken, or just text. */
export type Embedded =
  | { kind: "json"; value: JsonContainer }
  | { kind: "broken"; error: string }
  | { kind: "text" };

/** Whether text opens like a JSON object or array, so a parse failure means broken JSON, not prose like "[INFO] up". */
const LOOKS_LIKE_JSON = /^(\{\s*("|\})|\[\s*([[{"\-\d\]]|true|false|null))/;

/**
 * What a string holds. An object or array written as a string is `json`; so is one encoded more than
 * once: `"\"{\\\"a\\\":1}\""` gives `{ a: 1 }`. Text that opens like an object or array but doesn't
 * parse (truncated, unescaped quotes, a bad escape) is `broken`, with the parser's message. Scalars
 * and prose stay `text`, so `"42"`, `"true"` and `"[INFO] started"` aren't mistaken for JSON.
 */
export function inspectEmbedded(text: string): Embedded {
  let current = text;
  for (let layer = 0; layer < MAX_STRING_LAYERS; layer++) {
    const trimmed = current.trim();
    const first = trimmed[0];
    if (first !== "{" && first !== "[" && first !== '"') return { kind: "text" };
    let parsed: JsonValue;
    try {
      parsed = JSON.parse(trimmed) as JsonValue;
    } catch (e) {
      const broken = first !== '"' && LOOKS_LIKE_JSON.test(trimmed);
      return broken ? { kind: "broken", error: e instanceof Error ? e.message : String(e) } : { kind: "text" };
    }
    if (isContainer(parsed)) return { kind: "json", value: parsed };
    if (typeof parsed !== "string") return { kind: "text" };
    current = parsed;
  }
  return { kind: "text" };
}

/** The object or array a string holds when it is JSON written as a string, undefined otherwise. */
export function parseEmbedded(text: string): JsonContainer | undefined {
  const embedded = inspectEmbedded(text);
  return embedded.kind === "json" ? embedded.value : undefined;
}

/** The tree for a payload's text: its JSON, or undefined unless that is an object, array or string holding one. */
export function parseTree(text: string): JsonContainer | undefined {
  const parsed = parseJson(text);
  if (parsed === undefined) return undefined;
  if (isContainer(parsed)) return parsed;
  return typeof parsed === "string" ? parseEmbedded(parsed) : undefined;
}

/** A container's children as [label, value]: array indexes or object keys, in order. */
export function entriesOf(container: JsonContainer): [string | number, JsonValue][] {
  return Array.isArray(container) ? container.map((v, i) => [i, v]) : Object.entries(container);
}

/** "3 keys", "1 key", "0 items": the size of a container. */
export function describeSize(container: JsonContainer): string {
  const n = Array.isArray(container) ? container.length : Object.keys(container).length;
  const noun = Array.isArray(container) ? "item" : "key";
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

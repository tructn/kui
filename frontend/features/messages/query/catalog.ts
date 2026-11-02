// Learns what fields a topic's messages have, from a sample of them, so the
// query bar can suggest real paths, operators that fit their types, and values
// that actually occur. Messages in one topic often differ in shape (event types,
// schema versions), so every field records how many messages have it.

import type { KafkaMessage } from "../types";

export type JsonType = "string" | "number" | "boolean" | "null" | "object" | "array";

export interface ValueStat {
  /** The JSON value as it appeared. */
  value: string | number | boolean | null;
  /** Messages it appeared in. */
  count: number;
}

export interface FieldStats {
  /** How the field is written in a query, e.g. `value.items[*].sku` or `headers.x-trace-id`. */
  path: string;
  /** Path of the enclosing field; null for the top-level fields (key, value, headers…). */
  parent: string | null;
  /** The last part as written after the parent, e.g. `sku`, `"first name"` or `[*]`. */
  segment: string;
  /** Messages (of `FieldCatalog.sampled`) that have this field. */
  present: number;
  /** Messages per type the field had; a field can differ between messages. */
  types: Partial<Record<JsonType, number>>;
  /** The most common values (scalars only), most frequent first. */
  values: ValueStat[];
  /** More distinct values occurred than were kept, e.g. ids. */
  manyValues: boolean;
  /** Built-in message attribute (partition, offset, timestamp) rather than payload data. */
  builtin?: boolean;
  /** A string holding JSON (`"{\"a\":1}"`) in some messages: typed as the object/array inside. */
  jsonText?: boolean;
}

export interface FieldCatalog {
  sampled: number;
  fields: Map<string, FieldStats>;
  /** Parent path → its child fields, most common first. */
  children: Map<string, FieldStats[]>;
}

const MAX_DEPTH = 8;
const MAX_FIELDS = 2000;
const MAX_KEYS_PER_OBJECT = 200;
const MAX_TRACKED_VALUES = 200;
const MAX_VALUES_KEPT = 30;
const MAX_VALUE_LENGTH = 120;
const MAX_PAYLOAD_LENGTH = 512 * 1024;

const PLAIN_NAME = /^[\p{L}_$@][\p{L}\p{N}_$@-]*$/u;

/** A field name as written after a dot: bare when possible, otherwise "quoted". */
export function nameSegment(name: string): string {
  return PLAIN_NAME.test(name) ? name : `"${name.replaceAll('"', '""')}"`;
}

/** A JSON value written as a query literal. */
export function literal(value: string | number | boolean | null): string {
  if (value === null) return "NULL";
  if (typeof value === "string") return `'${value.replaceAll("'", "''")}'`;
  return String(value);
}

export function jsonType(value: unknown): JsonType {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  const type = typeof value;
  return type === "string" || type === "number" || type === "boolean" ? type : "object";
}

const LOOKS_LIKE_JSON = /^\s*[{[]/;

/** An object or array written inside a string; the Rust filter walks into these too. */
function embeddedJson(text: string): unknown {
  // The regex stops at the first non-space, so plain text costs almost nothing.
  if (text.length > MAX_PAYLOAD_LENGTH || !LOOKS_LIKE_JSON.test(text)) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

interface Builder {
  fields: Map<string, FieldStats>;
  /** Field path → value key → stat, while building. */
  values: Map<string, Map<string, ValueStat>>;
  /** What the current message already counted, so repeats in arrays count once. */
  seen: Set<string>;
}

function field(b: Builder, path: string, parent: string | null, segment: string): FieldStats | undefined {
  let stats = b.fields.get(path);
  if (!stats) {
    if (b.fields.size >= MAX_FIELDS) return undefined;
    stats = { path, parent, segment, present: 0, types: {}, values: [], manyValues: false };
    b.fields.set(path, stats);
  }
  return stats;
}

function record(b: Builder, path: string, parent: string | null, segment: string, value: unknown) {
  const stats = field(b, path, parent, segment);
  if (!stats) return;
  const type = jsonType(value);
  if (!b.seen.has(path)) {
    b.seen.add(path);
    stats.present++;
  }
  const typeKey = `${path}\u0000:${type}`;
  if (!b.seen.has(typeKey)) {
    b.seen.add(typeKey);
    stats.types[type] = (stats.types[type] ?? 0) + 1;
  }
  if (type === "object" || type === "array") return;
  if (typeof value === "string" && value.length > MAX_VALUE_LENGTH) {
    stats.manyValues = true;
    return;
  }
  const key = `${type}:${String(value)}`;
  const valueKey = `${path}\u0000=${key}`;
  if (b.seen.has(valueKey)) return;
  b.seen.add(valueKey);
  let tracked = b.values.get(path);
  if (!tracked) b.values.set(path, (tracked = new Map()));
  const stat = tracked.get(key);
  if (stat) stat.count++;
  else if (tracked.size < MAX_TRACKED_VALUES) tracked.set(key, { value: value as ValueStat["value"], count: 1 });
  else stats.manyValues = true;
}

/** Records `value` at `path` and everything inside it. */
function walk(b: Builder, path: string, parent: string | null, segment: string, value: unknown, depth: number) {
  // JSON written in a string counts as the object/array it holds: that's how the
  // filter walks it, and its escaped text would make a poor value suggestion.
  const inner = typeof value === "string" && depth < MAX_DEPTH ? embeddedJson(value) : undefined;
  if (inner !== undefined) {
    record(b, path, parent, segment, inner);
    const stats = b.fields.get(path);
    if (stats) stats.jsonText = true;
    walkChildren(b, path, inner, depth);
    return;
  }
  record(b, path, parent, segment, value);
  if (depth < MAX_DEPTH) walkChildren(b, path, value, depth);
}

function walkChildren(b: Builder, path: string, value: unknown, depth: number) {
  if (Array.isArray(value)) {
    const each = `${path}[*]`;
    for (const item of value.slice(0, MAX_KEYS_PER_OBJECT)) walk(b, each, path, "[*]", item, depth + 1);
  } else if (value !== null && typeof value === "object") {
    for (const [name, child] of Object.entries(value).slice(0, MAX_KEYS_PER_OBJECT)) {
      const segment = nameSegment(name);
      walk(b, `${path}.${segment}`, path, segment, child, depth + 1);
    }
  }
}

/** The payload as the Rust filter sees it: parsed JSON, or the text itself. */
function payloadValue(payload: KafkaMessage["value"]): unknown {
  if (!payload || payload.encoding !== "utf8" || payload.text.length > MAX_PAYLOAD_LENGTH) return payload?.text;
  try {
    return JSON.parse(payload.text);
  } catch {
    return payload.text;
  }
}

/** Builds the catalog from sampled messages (duplicates by partition/offset are skipped). */
export function buildCatalog(messages: Iterable<KafkaMessage>): FieldCatalog {
  const b: Builder = { fields: new Map(), values: new Map(), seen: new Set() };
  for (const name of ["partition", "offset", "timestamp"] as const) {
    const stats = field(b, name, null, name)!;
    stats.builtin = true;
    stats.manyValues = name !== "partition";
  }

  const done = new Set<string>();
  let sampled = 0;
  for (const m of messages) {
    const id = `${m.partition}:${m.offset}`;
    if (done.has(id)) continue;
    done.add(id);
    sampled++;
    b.seen = new Set();

    record(b, "partition", null, "partition", m.partition);
    record(b, "offset", null, "offset", m.offset);
    if (m.timestamp != null) record(b, "timestamp", null, "timestamp", m.timestamp);
    if (m.key) walk(b, "key", null, "key", payloadValue(m.key), 0);
    if (m.value) walk(b, "value", null, "value", payloadValue(m.value), 0);
    if (m.headers.length > 0) {
      record(b, "headers", null, "headers", {});
      for (const h of m.headers.slice(0, MAX_KEYS_PER_OBJECT)) {
        const segment = nameSegment(h.key);
        walk(b, `headers.${segment}`, "headers", segment, h.value, 1);
      }
    }
  }

  const children = new Map<string, FieldStats[]>();
  for (const stats of b.fields.values()) {
    const tracked = [...(b.values.get(stats.path)?.values() ?? [])].sort((x, y) => y.count - x.count);
    stats.values = tracked.slice(0, MAX_VALUES_KEPT);
    if (tracked.length > MAX_VALUES_KEPT) stats.manyValues = true;
    if (stats.parent !== null) {
      const list = children.get(stats.parent) ?? [];
      list.push(stats);
      children.set(stats.parent, list);
    }
  }
  for (const list of children.values()) list.sort((x, y) => y.present - x.present);
  return { sampled, fields: b.fields, children };
}

/** The types a field had, most common first. */
export function typesOf(stats: FieldStats | undefined): JsonType[] {
  if (!stats) return [];
  return (Object.entries(stats.types) as [JsonType, number][])
    .sort((x, y) => y[1] - x[1])
    .map(([type]) => type);
}

/** The field's types, e.g. `string`, `number | string`, or `time` for the timestamp. */
export function describeField(stats: FieldStats): string {
  if (stats.builtin) return stats.path === "timestamp" ? "time" : "number";
  const types = typesOf(stats).filter((t) => t !== "null" || Object.keys(stats.types).length === 1).join(" | ");
  return stats.jsonText ? `${types} (JSON text)` : types;
}

import { isContainer, parseJson, type JsonValue } from "@/lib/json-tree";

import type { RecordTemplate } from "./types";

/** The parts of a payload the inference reads. `KafkaMessage` payloads fit this shape. */
export interface SamplePayload {
  text: string;
  encoding: "utf8" | "hex";
  truncated?: boolean;
}

/** A message read from the topic, as a model for the template. */
export interface SampleRecord {
  key: SamplePayload | null;
  value: SamplePayload | null;
  headers: { key: string; value: string | null }[];
}

/** One message shape found in the topic, with a template that produces more of it. */
export interface Structure {
  /** The shape's signature; stable while the topic's data keeps that shape. */
  id: string;
  /** `value` is a JSON scalar; `text` is a payload that isn't JSON at all. */
  kind: "object" | "array" | "value" | "text";
  /** Top-level field names, in first-seen order. */
  fields: string[];
  /** Sampled messages with this shape. */
  count: number;
  template: Omit<RecordTemplate, "locale">;
}

/** Group id of payloads that aren't JSON. A JSON shape signature never equals it. */
const TEXT = "text";
/** Messages inspected at most; a page holds fewer, this only bounds a caller passing more. */
const MAX_SAMPLES = 500;
/** Shapes offered at most; the rest are rare enough to leave out. */
const MAX_STRUCTURES = 6;
/** Deeper values become `null` in the template, so a hostile document can't overflow the stack. */
const MAX_DEPTH = 16;
/** Array items, keys per object and header names merged at most per position. */
const MAX_ITEMS = 200;
/** A string field with at most this many distinct short values becomes `{{pick ...}}`. */
const MAX_PICK = 8;
/** Longer values read as free text rather than one of a set. */
const MAX_PICK_LENGTH = 32;

/**
 * Groups sampled messages by shape (the nesting of object keys; scalar types and array lengths
 * don't split a group) and builds a template for each, most common first. Binary, truncated and
 * tombstone values are skipped: they say nothing about the structure.
 */
export function inferStructures(samples: SampleRecord[]): Structure[] {
  const groups = new Map<string, { value: JsonValue | undefined; text: string; record: SampleRecord }[]>();
  for (const record of samples.slice(0, MAX_SAMPLES)) {
    if (!readable(record.value)) continue;
    const text = record.value.text;
    const value = parseJson(text);
    const id = value === undefined ? TEXT : shapeOf(value, 0);
    const group = groups.get(id);
    if (group) group.push({ value, text, record });
    else groups.set(id, [{ value, text, record }]);
  }
  return [...groups.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, MAX_STRUCTURES)
    .map(([id, members]) => {
      const first = members[0].value;
      const records = members.map((m) => m.record);
      const kind: Structure["kind"] =
        first === undefined ? "text" : Array.isArray(first) ? "array" : isContainer(first) ? "object" : "value";
      return {
        id,
        kind,
        fields: first !== undefined && isContainer(first) && !Array.isArray(first) ? Object.keys(first).slice(0, MAX_ITEMS) : [],
        count: members.length,
        template: {
          key: keyTemplate(records),
          value:
            kind === "text"
              ? stringPlaceholder(members.map((m) => m.text), "")
              : valueTemplate(members.map((m) => m.value), "", 0, ""),
          headers: headerTemplates(records),
        },
      };
    });
}

function readable(payload: SamplePayload | null): payload is SamplePayload {
  return payload !== null && payload.encoding === "utf8" && !payload.truncated;
}

function shapeOf(value: JsonValue, depth: number): string {
  if (depth >= MAX_DEPTH) return "…";
  if (Array.isArray(value)) return "[]";
  if (isContainer(value)) {
    const keys = Object.keys(value).sort().slice(0, MAX_ITEMS);
    return `{${keys.map((k) => `${JSON.stringify(k)}:${shapeOf(value[k], depth + 1)}`).join(",")}}`;
  }
  return "_";
}

type Scalar = string | number | boolean;

/**
 * Template text for every sampled value at one position. Objects merge their keys, arrays merge
 * their items into a single item template, and scalars become a placeholder.
 */
function valueTemplate(values: (JsonValue | undefined)[], name: string, depth: number, indent: string): string {
  const present = values.filter((v): v is JsonValue => v !== null && v !== undefined);
  if (present.length === 0 || depth >= MAX_DEPTH) return "null";
  const inner = `${indent}  `;

  const objects = present.filter((v): v is { [key: string]: JsonValue } => isContainer(v) && !Array.isArray(v));
  const arrays = present.filter((v): v is JsonValue[] => Array.isArray(v));
  if (objects.length >= arrays.length && objects.length > 0 && objects.length * 2 >= present.length) {
    const keys = [...new Set(objects.flatMap((o) => Object.keys(o)))].slice(0, MAX_ITEMS);
    if (keys.length === 0) return "{}";
    const lines = keys.map(
      (k) => `${inner}${jsonKey(k)}: ${valueTemplate(objects.map((o) => o[k]), k, depth + 1, inner)}`,
    );
    return `{\n${lines.join(",\n")}\n${indent}}`;
  }
  if (arrays.length > 0 && arrays.length * 2 >= present.length) {
    const items = arrays.flat().slice(0, MAX_ITEMS);
    if (items.length === 0) return "[]";
    return `[\n${inner}${valueTemplate(items, name, depth + 1, inner)}\n${indent}]`;
  }

  const scalars = present.filter((v): v is Scalar => !isContainer(v));
  const strings = scalars.filter((v): v is string => typeof v === "string");
  const numbers = scalars.filter((v): v is number => typeof v === "number");
  const booleans = scalars.filter((v): v is boolean => typeof v === "boolean");
  const most = Math.max(strings.length, numbers.length, booleans.length);
  if (most === 0) return "null";
  if (strings.length === most) return `"${stringPlaceholder(strings, name)}"`;
  if (numbers.length === most) return numberPlaceholder(numbers, name);
  return `{{bool ${Math.round((booleans.filter(Boolean).length / booleans.length) * 100)}}}`;
}

/** An object key as JSON, with `{{` escaped so the template parser doesn't read it as a placeholder. */
function jsonKey(key: string): string {
  return JSON.stringify(key).replaceAll("{{", "{\\u007b");
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/;
const IPV6 = /^[0-9a-f]*:[0-9a-f:]+$/i;
const MAC = /^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i;
const HEX = /^[0-9a-f]+$/i;
const PREFIXED_NUMBER = /^(\D*?)(\d{1,15})$/;
/** Text that can sit inside a template string as is: no JSON escapes, no placeholder braces. */
const SAFE_TEXT = /^[^"\\{}\u0000-\u001f]*$/;

/** Field names that say what a string holds, tried in order on the name without separators. */
const NAMED: [RegExp, string][] = [
  [/^(first|given)name$|^fname$/, "first_name"],
  [/^(last|family)name$|^surname$|^lname$/, "last_name"],
  [/^user(name)?$|^login$|^handle$/, "username"],
  [/email|mail$/, "email"],
  [/password|passwd|secret/, "password"],
  [/phone|mobile|tel(ephone)?$/, "phone"],
  [/company|organi[sz]ation|employer/, "company"],
  [/industry|sector/, "industry"],
  [/jobtitle|position|role$/, "job_title"],
  [/street|address(line)?\d*$/, "street"],
  [/city|town/, "city"],
  [/^(state|province|region)$/, "state"],
  [/zip|postal|postcode/, "zip"],
  [/countrycode/, "country_code"],
  [/country/, "country"],
  [/currency/, "currency"],
  [/useragent|^ua$/, "user_agent"],
  [/^ip(v4)?(address)?$|ipaddr/, "ipv4"],
  [/name$/, "name"],
  [/description|comment|message|summary|text|body|note/, "sentence"],
];

function stringPlaceholder(values: string[], name: string): string {
  const all = (test: (v: string) => boolean) => values.every(test);
  if (all((v) => UUID.test(v))) return "{{uuid}}";
  if (all((v) => EMAIL.test(v))) return "{{email}}";
  if (all((v) => ISO_DATETIME.test(v))) return "{{now_iso}}";
  if (all((v) => ISO_DATE.test(v))) return "{{date}}";
  if (all((v) => IPV4.test(v))) return "{{ipv4}}";
  if (all((v) => MAC.test(v))) return "{{mac}}";
  if (all((v) => IPV6.test(v))) return "{{ipv6}}";

  const numbered = numberedPlaceholder(values);
  if (numbered) return numbered;
  const length = values[0].length;
  if (length >= 8 && all((v) => v.length === length && HEX.test(v))) return `{{hex ${length}}}`;
  const mask = values[0].replace(/\d/g, "#");
  if (mask.includes("#") && SAFE_TEXT.test(mask) && all((v) => v.replace(/\d/g, "#") === mask)) {
    return `{{digits "${mask}"}}`;
  }

  const normalized = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  const named = NAMED.find(([pattern]) => pattern.test(normalized))?.[1];
  if (named === "country" && all((v) => /^[A-Z]{2}$/.test(v))) return "{{country_code}}";
  if (named) return `{{${named}}}`;

  const distinct = [...new Set(values)];
  const enumLike = (v: string) => SAFE_TEXT.test(v) && v.length <= MAX_PICK_LENGTH && v.split(/\s+/).length <= 3;
  if (distinct.length <= MAX_PICK && distinct.every(enumLike)) {
    return `{{pick ${distinct.map((v) => (v === "" || /\s/.test(v) ? `"${v}"` : v)).join(" ")}}}`;
  }
  const words = Math.round(values.reduce((n, v) => n + v.split(/\s+/).length, 0) / values.length);
  if (words <= 1) return "{{word}}";
  if (words <= 6) return `{{words ${words}}}`;
  return words <= 25 ? "{{sentence}}" : "{{paragraph}}";
}

/**
 * `order-17`, `order-42` → `order-{{seq 43}}` when every sampled value is distinct (an id, which
 * then continues past the existing ones), or `order-{{int 17 42}}` when values repeat.
 */
function numberedPlaceholder(values: string[]): string | null {
  const matches = values.map((v) => PREFIXED_NUMBER.exec(v));
  const prefix = matches[0]?.[1];
  if (prefix === undefined || !SAFE_TEXT.test(prefix) || !matches.every((m) => m?.[1] === prefix)) return null;
  const numbers = matches.map((m) => Number(m?.[2]));
  // Zero-padded numbers (`0042`) would lose their width as an int; `digits` keeps it.
  if (matches.some((m) => m?.[2].startsWith("0") && m[2].length > 1)) return null;
  const min = Math.min(...numbers);
  const max = Math.max(...numbers);
  return new Set(values).size === values.length
    ? `${prefix}{{seq ${max + 1}}}`
    : `${prefix}{{int ${min} ${max}}}`;
}

function numberPlaceholder(values: number[], name: string): string {
  const normalized = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (/^lat(itude)?$/.test(normalized)) return "{{latitude}}";
  if (/^(lon|lng|long|longitude)$/.test(normalized)) return "{{longitude}}";
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (values.every(Number.isSafeInteger)) {
    // Epoch millis between 2001 and 5138: a timestamp, not a count.
    if (min >= 1e12 && max < 1e14) return "{{now}}";
    if (min === max) return String(min);
    if (/(^|[a-z])id$/.test(normalized) && new Set(values).size === values.length) return `{{seq ${max + 1}}}`;
    return `{{int ${min} ${max}}}`;
  }
  if (!values.every(Number.isFinite)) return String(values[0]);
  if (min === max) return String(min);
  const decimals = Math.min(6, Math.max(...values.map((v) => String(v).split(".")[1]?.length ?? 0)));
  return `{{float ${min} ${max} ${decimals}}}`;
}

function keyTemplate(records: SampleRecord[]): string | null {
  const keys = records.flatMap((r) => (readable(r.key) ? [r.key.text] : []));
  return keys.length === 0 ? null : stringPlaceholder(keys, "key");
}

function headerTemplates(records: SampleRecord[]): { key: string; value: string }[] {
  // Names with `=` or line breaks can't be written as `name=template` lines.
  const names = [...new Set(records.flatMap((r) => r.headers.map((h) => h.key)))]
    .filter((n) => n !== "" && !/[=\n]/.test(n))
    .slice(0, MAX_ITEMS);
  return names.map((name) => {
    const values = records.flatMap((r) =>
      r.headers.filter((h) => h.key === name && h.value !== null).map((h) => h.value ?? ""),
    );
    return { key: name, value: values.length === 0 ? "" : stringPlaceholder(values, name) };
  });
}

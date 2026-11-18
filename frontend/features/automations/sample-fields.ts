import type { WebhookHeader } from "./types";

/** The message a body is tried on. Its headers are the message's, not the webhook's. */
export interface SampleMessage {
  value: string;
  key: string;
  headers: WebhookHeader[];
}

/** What each root a path can start with (`value`, `key`, `item`, ...) holds in the sample. */
export type SampleContext = Record<string, unknown>;

/** A field of the sample message, to pick into the body. */
export interface FieldNode {
  name: string;
  /** What goes into the mapping: `value.customer.name`, `item.sku`. */
  path: string;
  /** Undefined when the sample doesn't say. */
  value: unknown;
  /** An object's fields. A list is picked whole and mapped item by item, so it has none. */
  children: FieldNode[];
}

/** The parts of a topic message a sample needs. */
interface TopicMessage {
  key: { text: string; encoding: string } | null;
  value: { text: string; encoding: string } | null;
  headers: { key: string; value: string | null }[];
}

/** A topic message as a sample, or null when its value isn't text. */
export function sampleOf(message: TopicMessage | undefined): SampleMessage | null {
  if (message?.value?.encoding !== "utf8") return null;
  return {
    value: message.value.text,
    key: message.key?.encoding === "utf8" ? message.key.text : "",
    headers: message.headers.flatMap((h) => (h.value === null ? [] : [{ name: h.key, value: h.value }])),
  };
}

const MAX_DEPTH = 6;
/** A sample with thousands of fields must not render thousands of rows. */
const MAX_NODES = 300;
const MAX_LISTS = 20;

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

/** Like the backend: a key or value that is JSON is read as JSON, otherwise as text. */
function parseLoose(text: string): unknown {
  if (text.trim() === "") return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export function contextOf(sample: SampleMessage, topic: string): SampleContext {
  return {
    value: parseLoose(sample.value),
    key: parseLoose(sample.key),
    headers: Object.fromEntries(sample.headers.map((h) => [h.name, h.value])),
    topic: topic.trim() || undefined,
    partition: undefined,
    offset: undefined,
    timestamp: undefined,
  };
}

/** The value at `path` in the sample, read the way `template.rs` reads it. */
export function resolvePath(path: string, context: SampleContext): unknown {
  const [root = "", ...steps] = path.trim().split(".");
  // A header name may itself contain dots.
  if (root === "headers") return isObject(context.headers) ? context.headers[steps.join(".")] : undefined;
  return steps.reduce<unknown>((node, step) => {
    if (Array.isArray(node)) return /^\d+$/.test(step) ? node[Number(step)] : undefined;
    return isObject(node) ? node[step] : undefined;
  }, context[root]);
}

/** The context with `item` set to the first item of each list in `lists`, outermost first. */
export function withItem(context: SampleContext, lists: readonly string[]): SampleContext {
  return lists.reduce<SampleContext>((ctx, path) => {
    const list = resolvePath(path, ctx);
    return { ...ctx, item: Array.isArray(list) ? list[0] : list };
  }, context);
}

const ROOTS = ["value", "key", "headers", "topic", "partition", "offset", "timestamp"];

/** The fields on offer, `item` first when picking inside a list. */
export function fieldTree(context: SampleContext, hasItem: boolean): FieldNode[] {
  let left = MAX_NODES;
  const build = (name: string, path: string, value: unknown, depth: number): FieldNode => ({
    name,
    path,
    value,
    children:
      isObject(value) && depth < MAX_DEPTH
        ? Object.entries(value).flatMap(([k, v]) => (left-- > 0 ? [build(k, `${path}.${k}`, v, depth + 1)] : []))
        : [],
  });
  return (hasItem ? ["item", ...ROOTS] : ROOTS).map((root) => build(root, root, context[root], 0));
}

/** Paths of the lists in the sample's value, to send one request per item of. */
export function listPaths(context: SampleContext): string[] {
  const out: string[] = [];
  const walk = (node: unknown, path: string, depth: number) => {
    if (out.length >= MAX_LISTS) return;
    if (Array.isArray(node)) out.push(path);
    else if (isObject(node) && depth < MAX_DEPTH)
      for (const [k, v] of Object.entries(node)) walk(v, `${path}.${k}`, depth + 1);
  };
  walk(context.value, "value", 0);
  return out;
}

/** The sample's value indented when it is JSON, as it is shown to the user. */
export function formatSample(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

/** A short, plain-text look at a value. */
export function describeValue(value: unknown): string {
  if (value === undefined) return "";
  if (Array.isArray(value)) return value.length === 1 ? "1 item" : `${value.length} items`;
  if (isObject(value)) return "{…}";
  const text = typeof value === "string" ? JSON.stringify(value) : String(value);
  return text.length > 40 ? `${text.slice(0, 39)}…` : text;
}

/** A name for a picked field: the last part of its path, never one already used. */
export function keyFor(path: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = path.trim().split(".").at(-1) || "field";
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) if (!used.has(`${base}_${n}`)) return `${base}_${n}`;
}

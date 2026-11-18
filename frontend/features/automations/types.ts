// Mirrors `crates/kui_desktop/src/features/automations/model.rs`.

export const HTTP_METHODS = ["POST", "PUT", "PATCH"] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export interface WebhookHeader {
  name: string;
  value: string;
}

/** What an automation does. A new kind of action is a new variant, and `switch` on `kind` finds every place to handle it. */
export type Action = {
  kind: "webhook";
  url: string;
  method: HttpMethod;
  headers: WebhookHeader[];
  body: Body;
};

/** What the request body is made of. */
export type Body =
  /** The message described as JSON. */
  | { kind: "envelope" }
  /** Text with placeholders such as `{{value.id | json}}`. */
  | { kind: "template"; text: string }
  /** A new JSON object built from the message field by field. */
  | { kind: "mapping"; fields: FieldMapping[] };

export type BodyKind = Body["kind"];

export interface FieldMapping {
  /** Dotted path of where it goes: `customer.name`, `items.0.sku`. */
  target: string;
  source: Source;
  transform: Transform | null;
  /** Used when the source is missing or null. */
  default: unknown;
}

export type Source =
  | { kind: "field"; path: string }
  | { kind: "fixed"; value: unknown }
  | { kind: "template"; text: string }
  /** The list at `path` with every item rebuilt by `fields`, which read the item as `item`. */
  | { kind: "each"; path: string; fields: FieldMapping[] };

export type SourceKind = Source["kind"];

export const TRANSFORMS = [
  "trim",
  "upper",
  "lower",
  "toNumber",
  "toString",
  "toBoolean",
  "epochToIso",
  "count",
  "join",
  "first",
  "last",
] as const;
export type Transform = (typeof TRANSFORMS)[number];

export const TRANSFORM_LABELS: Record<Transform, string> = {
  trim: "Trim spaces",
  upper: "UPPERCASE",
  lower: "lowercase",
  toNumber: "To number",
  toString: "To text",
  toBoolean: "To true/false",
  epochToIso: "Epoch ms to date",
  count: "Count items",
  join: "Join items as text",
  first: "First item",
  last: "Last item",
};

export function emptyMapping(): FieldMapping {
  return { target: "", source: { kind: "field", path: "" }, transform: null, default: null };
}

/** What a body would be for a sample message. */
export interface BodyPreview {
  /** The first request's body; null when the message has no items to send. */
  first: string | null;
  /** One, or one per item when the route splits messages. */
  requests: number;
}

/** A made-up message to try a body on. */
export interface PreviewSample {
  topic: string;
  key: string | null;
  value: string | null;
  headers: WebhookHeader[];
}

export interface Automation {
  /** Empty string for an automation that hasn't been saved yet. */
  id: string;
  name: string;
  enabled: boolean;
  clusterId: string;
  topic: string;
  /** MQL filter; null fires on every message. */
  query: string | null;
  maxPerMinute: number;
  /** Branches run for every matching message, side by side. */
  routes: Route[];
}

/** One branch of a pipeline: messages that also match `query` are shaped and sent by `action`. */
export interface Route {
  /** Names the route in the graph; unique within the automation. */
  id: string;
  /** MQL filter for this route only; null for every message. */
  query: string | null;
  /** Path of a list, such as `value.items`, to send one request per item; null for one per message. */
  split: string | null;
  action: Action;
}

export function emptyRoute(taken: readonly Route[] = []): Route {
  let n = 1;
  while (taken.some((r) => r.id === `route-${n}`)) n++;
  return {
    id: `route-${n}`,
    query: null,
    split: null,
    action: { kind: "webhook", url: "", method: "POST", headers: [], body: { kind: "envelope" } },
  };
}

export type RunState = "running" | "retrying" | "stopped";

export interface AutomationStatus {
  id: string;
  state: RunState;
  fired: number;
  failed: number;
  /** Matching messages skipped because of `maxPerMinute`. */
  dropped: number;
  lastFiredAt: number | null;
  lastError: string | null;
}

export const DEFAULT_MAX_PER_MINUTE = 60;
export const MAX_PER_MINUTE = 600;
/** Mirrors `MAX_ROUTES` in `validate.rs`. */
export const MAX_ROUTES = 10;

export function emptyAutomation(clusterId: string): Automation {
  return {
    id: "",
    name: "",
    enabled: true,
    clusterId,
    topic: "",
    query: null,
    maxPerMinute: DEFAULT_MAX_PER_MINUTE,
    routes: [emptyRoute()],
  };
}

import { formatLooseValue, parseLooseValue } from "@/lib/loose-value";

import type { Source } from "./types";

/** The names a message field path can start with. Mirrors `template.rs`. */
const FIELD_ROOT = /^(key|value|headers|topic|partition|offset|timestamp|truncated)(\.|$)/;

/**
 * One box covers every kind of source, so the user never picks a type:
 * `{{…}}` is a template, a message field such as `value.id` is a field, and anything else is a
 * fixed value (`42`, `true` and `{"a":1}` are JSON; other text is text).
 */
export function parseSource(text: string): Source {
  if (text.includes("{{")) return { kind: "template", text };
  if (FIELD_ROOT.test(text.trim())) return { kind: "field", path: text.trim() };
  return { kind: "fixed", value: parseLooseValue(text) };
}

/** The text that `parseSource` turns back into `source`. */
export function formatSource(source: Source): string {
  switch (source.kind) {
    case "field":
      return source.path;
    case "template":
      return source.text;
    case "fixed": {
      const text = formatLooseValue(source.value);
      // Text that reads like a field or template must stay quoted to remain a fixed value.
      return typeof source.value === "string" && parseSource(text).kind !== "fixed" ? JSON.stringify(source.value) : text;
    }
  }
}

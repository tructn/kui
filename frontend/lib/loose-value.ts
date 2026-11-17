/**
 * A fixed value or default is typed into a text box: `42`, `true` and `{"a":1}` are
 * those JSON values, anything else is text. To force text that looks like JSON, quote it: `"42"`.
 */
export function parseLooseValue(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return text;
  }
}

/** The text that `parseLooseValue` turns back into `value`. */
export function formatLooseValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") {
    try {
      JSON.parse(value);
      return JSON.stringify(value); // would read back as another type, so keep the quotes
    } catch {
      return value;
    }
  }
  return JSON.stringify(value);
}

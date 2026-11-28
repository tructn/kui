const numberFormat = new Intl.NumberFormat();

export function formatNumber(value: number): string {
  return numberFormat.format(value);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

// Every time in the UI is UTC, so it reads the same as broker logs and on every teammate's machine.

/** UTC date-time with milliseconds, e.g. `2026-10-12 08:15:02.123 UTC`. */
export function formatTimestamp(epochMs: number | null): string {
  if (epochMs == null) return "—";
  return `${new Date(epochMs).toISOString().slice(0, 23).replace("T", " ")} UTC`;
}

/** UTC date-time to the second, e.g. `2026-10-12 08:15:02 UTC`. */
export function formatDateTime(epochMs: number): string {
  return `${new Date(epochMs).toISOString().slice(0, 19).replace("T", " ")} UTC`;
}

/**
 * A one-line preview of at most `maxChars` source characters, whitespace runs collapsed,
 * ending in `…` when cut. Table cells render this instead of the full payload, which can be
 * megabytes; CSS `text-ellipsis` still trims it to the column width.
 */
export function previewLine(text: string, maxChars = 1000): string {
  const line = text.slice(0, maxChars).replace(/\s+/g, " ").trim();
  return text.length > maxChars ? `${line}…` : line;
}

/** Pretty-prints JSON; returns the input unchanged if it isn't JSON. */
export function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

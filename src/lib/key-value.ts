/** Parses `key=value` lines (blank and malformed lines are skipped). */
export function parseKeyValueLines(text: string): [string, string][] {
  return text
    .split("\n")
    .map((line) => {
      const separator = line.indexOf("=");
      return separator > 0 ? ([line.slice(0, separator).trim(), line.slice(separator + 1).trim()] as [string, string]) : null;
    })
    .filter((pair): pair is [string, string] => pair !== null);
}

export function formatKeyValueLines(pairs: Record<string, string>): string {
  return Object.entries(pairs)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

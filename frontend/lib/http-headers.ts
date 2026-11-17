/** One `Name: value` per line; blank and malformed lines are skipped. */
export function parseHeaderLines(text: string): { name: string; value: string }[] {
  return text.split("\n").flatMap((line) => {
    const separator = line.indexOf(":");
    if (separator <= 0) return [];
    return [{ name: line.slice(0, separator).trim(), value: line.slice(separator + 1).trim() }];
  });
}

export function formatHeaderLines(headers: { name: string; value: string }[]): string {
  return headers.map((h) => `${h.name}: ${h.value}`).join("\n");
}

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

/** Local date-time with milliseconds, e.g. `2026-10-12 08:15:02.123`. */
export function formatTimestamp(epochMs: number | null): string {
  if (epochMs == null) return "—";
  const d = new Date(epochMs);
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
  );
}

/** Pretty-prints JSON; returns the input unchanged if it isn't JSON. */
export function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

/**
 * Indents XML one element per line, keeping short text inline (`<a>text</a>`).
 * A display aid, not a parser: input that isn't well-formed is indented as best it can be.
 */
export function prettyXml(xml: string): string {
  const tokens = xml.trim().match(/<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->|<[^>]+>|[^<]+/g);
  if (!tokens) return xml;
  const isClose = (t: string | undefined) => t?.startsWith("</") ?? false;
  const isOpen = (t: string) => /^<[^!?/]/.test(t) && !t.endsWith("/>");
  const lines: string[] = [];
  let depth = 0;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const indent = "  ".repeat(depth);
    if (isClose(token)) {
      depth = Math.max(0, depth - 1);
      lines.push("  ".repeat(depth) + token);
    } else if (isOpen(token)) {
      const [next, after] = [tokens[i + 1], tokens[i + 2]];
      if (isClose(next)) {
        lines.push(indent + token + next);
        i += 1;
      } else if (next && !next.startsWith("<") && isClose(after)) {
        lines.push(indent + token + next.trim() + after);
        i += 2;
      } else {
        lines.push(indent + token);
        depth++;
      }
    } else if (token.startsWith("<")) {
      lines.push(indent + token); // self-closing, comment, CDATA, declaration
    } else if (token.trim()) {
      lines.push(indent + token.trim());
    }
  }
  return lines.join("\n");
}

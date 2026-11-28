export type TemplateTokenKind = "placeholder" | "key" | "string" | "number" | "literal" | "punct";

export interface TemplateToken {
  kind: TemplateTokenKind;
  from: number;
  to: number;
}

const NUMBER = /-?\d+(\.\d+)?([eE][+-]?\d+)?/y;
const LITERAL = /true|false|null/y;

/**
 * Highlighting tokens for a template: JSON with `{{placeholders}}`, which may sit inside strings.
 * A template needn't be valid JSON, so this never fails; anything it doesn't know is left plain.
 */
export function tokenizeTemplate(text: string): TemplateToken[] {
  const tokens: TemplateToken[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (text.startsWith("{{", i)) {
      const end = placeholderEnd(text, i);
      tokens.push({ kind: "placeholder", from: i, to: end });
      i = end;
    } else if (c === '"') {
      i = scanString(text, i, tokens);
    } else if ("{}[],:".includes(c)) {
      tokens.push({ kind: "punct", from: i, to: i + 1 });
      i++;
    } else if (match(NUMBER, text, i) || match(LITERAL, text, i)) {
      const kind = /[-\d]/.test(c) ? "number" : "literal";
      const end = kind === "number" ? NUMBER.lastIndex : LITERAL.lastIndex;
      tokens.push({ kind, from: i, to: end });
      i = end;
    } else {
      i++;
    }
  }
  return tokens;
}

function match(pattern: RegExp, text: string, at: number): boolean {
  pattern.lastIndex = at;
  return pattern.test(text);
}

/** Index just past the `}}` closing the placeholder at `start`, or the end of the text if unclosed. */
function placeholderEnd(text: string, start: number): number {
  const close = text.indexOf("}}", start + 2);
  return close === -1 ? text.length : close + 2;
}

/**
 * Pushes the string at `start` (and the placeholders inside it) and returns the index after it.
 * A string followed by `:` is an object key. Unterminated strings stop at the line's end.
 */
function scanString(text: string, start: number, tokens: TemplateToken[]): number {
  const parts: TemplateToken[] = [];
  let segment = start;
  let i = start + 1;
  while (i < text.length && text[i] !== '"' && text[i] !== "\n") {
    if (text[i] === "\\") {
      i += 2;
    } else if (text.startsWith("{{", i)) {
      if (i > segment) parts.push({ kind: "string", from: segment, to: i });
      const end = placeholderEnd(text, i);
      parts.push({ kind: "placeholder", from: i, to: end });
      i = segment = end;
    } else {
      i++;
    }
  }
  if (text[i] === '"') i++;
  if (i > segment) parts.push({ kind: "string", from: segment, to: Math.min(i, text.length) });
  const isKey = /^\s*:/.test(text.slice(i, i + 64));
  for (const part of parts) tokens.push(isKey && part.kind === "string" ? { ...part, kind: "key" } : part);
  return i;
}

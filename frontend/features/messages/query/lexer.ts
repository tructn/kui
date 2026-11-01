// A forgiving tokenizer for the message filter, used for highlighting and
// completion while the user types. Rust (`crates/kui_tql`)
// is the real parser; this one never fails: half-typed input still yields tokens.

export type TokenKind =
  | "ident"
  | "quoted" // "double quoted name"
  | "string" // 'text'
  | "number"
  | "dot"
  | "comma"
  | "lparen"
  | "rparen"
  | "lbracket"
  | "rbracket"
  | "star"
  | "op" // = != <> < <= > >=
  | "unknown";

export interface Token {
  kind: TokenKind;
  /** The source text, quotes included. */
  text: string;
  /** For strings and quoted names: the text inside the quotes (doubled quotes undone). */
  value: string;
  start: number;
  end: number;
  /** A string or quoted name missing its closing quote. */
  open?: boolean;
}

export const KEYWORDS = [
  "AND",
  "OR",
  "NOT",
  "LIKE",
  "ILIKE",
  "CONTAINS",
  "IN",
  "BETWEEN",
  "IS",
  "NULL",
  "TRUE",
  "FALSE",
  "WHERE",
] as const;

/** Mirrors `Root::ALL` in `parser.rs`. */
export const ROOTS = ["key", "value", "headers", "partition", "offset", "timestamp"] as const;
export type RootName = (typeof ROOTS)[number];

/** Mirrors `Func::ALL` in `parser.rs`. */
export const FUNCTIONS = ["lower", "upper", "trim", "length", "type"] as const;

export function isKeyword(token: Token | undefined, word?: string): boolean {
  if (token?.kind !== "ident") return false;
  const upper = token.text.toUpperCase();
  return word ? upper === word : (KEYWORDS as readonly string[]).includes(upper);
}

const IDENT_START = /[\p{L}_$@]/u;
const IDENT_CHAR = /[\p{L}\p{N}_$@-]/u;
const DIGIT = /[0-9]/;

export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const push = (kind: TokenKind, start: number, extra: Partial<Token> = {}) =>
    tokens.push({ kind, text: input.slice(start, i), value: input.slice(start, i), start, end: i, ...extra });

  while (i < input.length) {
    const c = input[i];
    const start = i;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "'" || c === '"') {
      let value = "";
      let open = true;
      i++;
      while (i < input.length) {
        if (input[i] === c && input[i + 1] === c) {
          value += c;
          i += 2;
        } else if (input[i] === c) {
          i++;
          open = false;
          break;
        } else {
          value += input[i++];
        }
      }
      push(c === "'" ? "string" : "quoted", start, { value, open });
      continue;
    }
    const startsNumber =
      DIGIT.test(c) ||
      (c === "." && DIGIT.test(input[i + 1] ?? "")) ||
      (c === "-" && (DIGIT.test(input[i + 1] ?? "") || (input[i + 1] === "." && DIGIT.test(input[i + 2] ?? ""))));
    if (startsNumber) {
      i++;
      while (i < input.length && /[0-9._eE]/.test(input[i])) i++;
      push("number", start);
      continue;
    }
    if (IDENT_START.test(c)) {
      i++;
      while (i < input.length && IDENT_CHAR.test(input[i])) i++;
      push("ident", start);
      continue;
    }
    const two = input.slice(i, i + 2);
    if (["!=", "<>", "<=", ">=", "=="].includes(two)) {
      i += 2;
      push("op", start);
      continue;
    }
    i++;
    const single: Record<string, TokenKind> = {
      ".": "dot",
      ",": "comma",
      "(": "lparen",
      ")": "rparen",
      "[": "lbracket",
      "]": "rbracket",
      "*": "star",
      "=": "op",
      "<": "op",
      ">": "op",
    };
    push(single[c] ?? "unknown", start);
  }
  return tokens;
}

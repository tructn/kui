// Suggestions for the message filter at the caret: fields from the sampled
// messages, operators that fit the field's types, values that actually occur,
// and AND / OR once a condition is complete.

import { describeField, type FieldCatalog, type FieldStats, type JsonType, literal, nameSegment, typesOf } from "./catalog";
import { FUNCTIONS, isKeyword, ROOTS, type Token, tokenize } from "./lexer";

export type SuggestionKind = "field" | "function" | "operator" | "keyword" | "value";

export interface Suggestion {
  label: string;
  /** Replaces the completion's `from`–`to` range. */
  insert: string;
  kind: SuggestionKind;
  /** Short hint shown beside the label, e.g. `string`. */
  detail?: string;
  /** Where the caret goes within `insert` (default: its end). */
  caret?: number;
  /** Suggest again right after accepting this one (e.g. operators after a field). */
  retrigger?: boolean;
}

export interface Completion {
  from: number;
  to: number;
  items: Suggestion[];
}

const MAX_ITEMS = 60;

/** One side of a condition: a field path (canonical, for catalog lookups), maybe inside a function. */
interface Operand {
  path: string | null;
  func: string | null;
  literal: boolean;
}

type Expect =
  | "operand" // a field, function, NOT or (
  | "operator" // after the left side
  | "notOp" // after `x NOT`
  | "is" // after `x IS`
  | "isNot" // after `x IS NOT`
  | "inOpen" // after `x IN`
  | "value" // the right side
  | "inNext" // after a value in IN ( … )
  | "betweenAnd" // after `x BETWEEN a`
  | "fnClose" // after a function's argument
  | "connector" // after a complete condition
  | "invalid";

type ValueRole = "single" | "in" | "betweenLow" | "betweenHigh";
type Frame = { kind: "group" } | { kind: "in" } | { kind: "fn"; name: string; outer: Expect };

interface PathState {
  start: number;
  /** Canonical path so far: indexes become [*] so the catalog can be consulted. */
  canonical: string;
  /** Ends with `.` or `[`: the next segment is being typed. */
  open: "dot" | "bracket" | null;
}

interface State {
  expect: Expect;
  stack: Frame[];
  lhs: Operand | null;
  op: string | null;
  role: ValueRole;
  path: PathState | null;
  /** A function's argument, until its `)` arrives. */
  fnArg?: Operand;
}

const WORD_CHAR = /[\p{L}\p{N}_$@-]/u;

/** Suggestions for the caret at `caret` in `text`. */
export function complete(text: string, caret: number, catalog: FieldCatalog): Completion {
  const tokens = tokenize(text.slice(0, caret));
  let partial: Token | null = null;
  const last = tokens.at(-1);
  if (last && last.end === caret && (last.kind === "ident" || last.kind === "number" || last.open)) {
    partial = last;
    tokens.pop();
  }
  // Replace the whole word under the caret, not just the part before it.
  let to = caret;
  if (!partial || partial.kind === "ident") while (to < text.length && WORD_CHAR.test(text[to])) to++;
  const from = partial ? partial.start : caret;

  const state = run(tokens);
  const prefix = partial ? (partial.kind === "string" ? partial.value : partial.text) : "";
  const items = suggest(state, catalog, prefix, partial);
  if (state.path?.open && state.expect !== "invalid") {
    return { from, to, items: pathItems(state.path, catalog, prefix) };
  }
  return { from, to, items: items.slice(0, MAX_ITEMS) };
}

function run(tokens: Token[]): State {
  const s: State = { expect: "operand", stack: [], lhs: null, op: null, role: "single", path: null };
  if (isKeyword(tokens[0], "WHERE")) tokens = tokens.slice(1);

  for (let i = 0; i < tokens.length && s.expect !== "invalid"; i++) {
    const t = tokens[i];

    // Inside a path: `.name`, `[0]`, `[*]`, `['name']`
    if (s.path) {
      if (s.path.open === "dot") {
        if (t.kind === "ident" || t.kind === "quoted" || t.kind === "string" || t.kind === "number") {
          const name = t.kind === "ident" || t.kind === "number" ? t.text : t.value;
          s.path = { ...s.path, canonical: `${s.path.canonical}.${nameSegment(name)}`, open: null };
          continue;
        }
        s.expect = "invalid";
        break;
      }
      if (s.path.open === "bracket") {
        if (t.kind === "rbracket") {
          s.path = { ...s.path, open: null };
          continue;
        }
        if (t.kind === "number" || t.kind === "star") {
          s.path = { ...s.path, canonical: `${s.path.canonical}[*]` };
          continue;
        }
        if (t.kind === "string" || t.kind === "quoted") {
          s.path = { ...s.path, canonical: `${s.path.canonical}.${nameSegment(t.value)}` };
          continue;
        }
        s.expect = "invalid";
        break;
      }
      if (t.kind === "dot") {
        s.path = { ...s.path, open: "dot" };
        continue;
      }
      if (t.kind === "lbracket") {
        s.path = { ...s.path, open: "bracket" };
        continue;
      }
      const path = s.path.canonical;
      s.path = null;
      finishOperand(s, { path, func: null, literal: false });
      i--; // look at this token again in the new state
      continue;
    }

    switch (s.expect) {
      case "operand":
      case "value":
        if (s.expect === "operand" && isKeyword(t, "NOT")) break;
        if (s.expect === "operand" && t.kind === "lparen") {
          s.stack.push({ kind: "group" });
          break;
        }
        if (t.kind === "ident" && tokens[i + 1]?.kind === "lparen" && isFunction(t.text)) {
          s.stack.push({ kind: "fn", name: t.text.toLowerCase(), outer: s.expect });
          s.expect = "value"; // the argument
          s.role = "single";
          i++;
          break;
        }
        if (t.kind === "ident" && isRoot(t.text)) {
          s.path = { start: t.start, canonical: t.text.toLowerCase(), open: null };
          break;
        }
        if (t.kind === "string" || t.kind === "number" || isKeyword(t, "TRUE") || isKeyword(t, "FALSE") || isKeyword(t, "NULL")) {
          finishOperand(s, { path: null, func: null, literal: true });
          break;
        }
        s.expect = "invalid";
        break;

      case "operator":
        if (t.kind === "op" || isKeyword(t, "LIKE") || isKeyword(t, "ILIKE") || isKeyword(t, "CONTAINS")) {
          s.op = t.text.toUpperCase();
          s.expect = "value";
          s.role = "single";
        } else if (isKeyword(t, "NOT")) s.expect = "notOp";
        else if (isKeyword(t, "IS")) s.expect = "is";
        else if (isKeyword(t, "IN")) {
          s.op = "IN";
          s.expect = "inOpen";
        } else if (isKeyword(t, "BETWEEN")) {
          s.op = "BETWEEN";
          s.expect = "value";
          s.role = "betweenLow";
        } else connect(s, t);
        break;

      case "notOp":
        if (isKeyword(t, "LIKE") || isKeyword(t, "ILIKE") || isKeyword(t, "CONTAINS")) {
          s.op = t.text.toUpperCase();
          s.expect = "value";
          s.role = "single";
        } else if (isKeyword(t, "IN")) {
          s.op = "IN";
          s.expect = "inOpen";
        } else if (isKeyword(t, "BETWEEN")) {
          s.op = "BETWEEN";
          s.expect = "value";
          s.role = "betweenLow";
        } else s.expect = "invalid";
        break;

      case "is":
        if (isKeyword(t, "NOT")) s.expect = "isNot";
        else if (isKeyword(t, "NULL")) s.expect = "connector";
        else s.expect = "invalid";
        break;

      case "isNot":
        s.expect = isKeyword(t, "NULL") ? "connector" : "invalid";
        break;

      case "inOpen":
        if (t.kind === "lparen") {
          s.stack.push({ kind: "in" });
          s.expect = "value";
          s.role = "in";
        } else s.expect = "invalid";
        break;

      case "inNext":
        if (t.kind === "comma") s.expect = "value";
        else if (t.kind === "rparen" && s.stack.at(-1)?.kind === "in") {
          s.stack.pop();
          s.expect = "connector";
        } else s.expect = "invalid";
        break;

      case "betweenAnd":
        if (isKeyword(t, "AND")) {
          s.expect = "value";
          s.role = "betweenHigh";
        } else s.expect = "invalid";
        break;

      case "fnClose": {
        const frame = s.stack.at(-1);
        if (t.kind === "rparen" && frame?.kind === "fn") {
          s.stack.pop();
          s.expect = frame.outer;
          finishOperand(s, { path: s.fnArg?.path ?? null, func: frame.name, literal: false });
        } else s.expect = "invalid";
        break;
      }

      case "connector":
        connect(s, t);
        break;
    }
  }
  // A path that ends at the caret (`value.status|` with no partial) is complete.
  if (s.path && !s.path.open) {
    const path = s.path.canonical;
    s.path = null;
    finishOperand(s, { path, func: null, literal: false });
  }
  return s;
}

/** AND / OR / `)` after a complete condition (or a bare field, which tests truthiness). */
function connect(s: State, t: Token) {
  if (isKeyword(t, "AND") || isKeyword(t, "OR")) {
    s.expect = "operand";
    s.lhs = null;
    s.op = null;
  } else if (t.kind === "rparen" && s.stack.at(-1)?.kind === "group") {
    s.stack.pop();
    s.expect = "connector";
  } else s.expect = "invalid";
}

function finishOperand(s: State, operand: Operand) {
  if (s.stack.at(-1)?.kind === "fn") {
    s.fnArg = operand;
    s.expect = "fnClose";
    return;
  }
  if (s.expect === "operand") {
    s.lhs = operand;
    s.op = null;
    s.expect = "operator";
    return;
  }
  // The right side of a condition.
  if (s.role === "in") s.expect = "inNext";
  else if (s.role === "betweenLow") s.expect = "betweenAnd";
  else s.expect = "connector";
}

function isRoot(word: string) {
  return (ROOTS as readonly string[]).includes(word.toLowerCase());
}

function isFunction(word: string) {
  return (FUNCTIONS as readonly string[]).includes(word.toLowerCase());
}

function suggest(s: State, catalog: FieldCatalog, prefix: string, partial: Token | null): Suggestion[] {
  switch (s.expect) {
    case "operand":
      return operandItems(catalog, prefix, s);
    case "operator":
      return keywordMatch(operatorItems(s.lhs, catalog), prefix);
    case "notOp":
      return keywordMatch(
        [op("LIKE", "pattern: % any text, _ one character"), op("ILIKE", "LIKE, ignoring case"), op("CONTAINS", "text or array element"), inOp(), op("BETWEEN", "x BETWEEN low AND high")],
        prefix,
      );
    case "is":
      return keywordMatch([kw("NULL", "missing or null"), kw("NOT NULL", "present")], prefix);
    case "isNot":
      return keywordMatch([kw("NULL", "present")], prefix);
    case "inOpen":
      return [{ label: "( … )", insert: "()", caret: 1, kind: "operator", retrigger: true }];
    case "value":
      return valueItems(s, catalog, prefix, partial);
    case "inNext":
      return [
        { label: ",", insert: ", ", kind: "operator", detail: "another value", retrigger: true },
        { label: ")", insert: ") ", kind: "operator", detail: "end the list", retrigger: true },
      ];
    case "betweenAnd":
      return keywordMatch([kw("AND", "the upper bound")], prefix);
    case "fnClose":
      return [{ label: ")", insert: ") ", kind: "operator", retrigger: true }];
    case "connector": {
      const items = [kw("AND", "both must match"), kw("OR", "either may match")];
      if (s.stack.some((f) => f.kind === "group")) items.push({ label: ")", insert: ") ", kind: "operator", retrigger: true });
      return keywordMatch(items, prefix);
    }
    case "invalid":
      return [];
  }
}

function kw(word: string, detail?: string): Suggestion {
  return { label: word, insert: `${word} `, kind: "keyword", detail, retrigger: true };
}

function op(word: string, detail?: string): Suggestion {
  return { label: word, insert: `${word} `, kind: "operator", detail, retrigger: true };
}

function inOp(): Suggestion {
  return { label: "IN ( … )", insert: "IN ()", caret: 4, kind: "operator", detail: "any of a list", retrigger: true };
}

/** Keeps items whose label starts with (then contains) what was typed, ignoring case. */
function keywordMatch(items: Suggestion[], prefix: string): Suggestion[] {
  if (!prefix) return items;
  const p = prefix.toLowerCase();
  const starts = items.filter((i) => i.label.toLowerCase().startsWith(p));
  const contains = items.filter((i) => !starts.includes(i) && i.label.toLowerCase().includes(p));
  return [...starts, ...contains];
}

/** What to append after a field: `.` to go inside objects, a space otherwise (operators come next). */
function fieldInsert(stats: FieldStats | undefined, catalog: FieldCatalog, path: string): { suffix: string } {
  const main = typesOf(stats)[0];
  if (main === "object" && catalog.children.has(path)) return { suffix: "." };
  if (main === "array" && typesOf(catalog.fields.get(`${path}[*]`))[0] === "object") {
    return { suffix: "[*]." };
  }
  return { suffix: " " };
}

function fieldItem(stats: FieldStats, catalog: FieldCatalog, label = stats.path): Suggestion {
  const { suffix } = fieldInsert(stats, catalog, stats.path);
  return {
    label,
    insert: label + suffix,
    kind: "field",
    detail: describeField(stats),
    retrigger: true,
  };
}

function operandItems(catalog: FieldCatalog, prefix: string, s: State): Suggestion[] {
  const p = prefix.toLowerCase();
  // Key/value never seen in the sample (e.g. a topic without keys) are still allowed, just ranked last.
  const roots: Suggestion[] = ROOTS.map((root): Suggestion => {
    const stats = catalog.fields.get(root);
    if (stats) return fieldItem(stats, catalog);
    return { label: root, insert: `${root} `, kind: "field", detail: "not seen", retrigger: true };
  }).sort((a, b) => Number(a.detail === "not seen") - Number(b.detail === "not seen"));

  // Every nested field, so `cust` finds `value.customer.name` without knowing the nesting.
  const nested = [...catalog.fields.values()].filter((f) => f.parent !== null);
  let fields: FieldStats[];
  if (!p) {
    // Nothing typed: the most common top-level payload fields after the roots.
    fields = nested.filter((f) => f.parent === "value" || f.parent === "key").sort(byPresence).slice(0, 25);
  } else {
    const scored = nested
      .map((f) => ({ f, score: matchScore(f, p) }))
      .filter((x) => x.score > 0)
      .sort((x, y) => y.score - x.score || byPresence(x.f, y.f) || x.f.path.length - y.f.path.length);
    fields = scored.map((x) => x.f);
  }

  const functions: Suggestion[] = FUNCTIONS.map((name) => ({
    label: `${name}( )`,
    insert: `${name}(`,
    kind: "function",
    detail: FUNCTION_DETAIL[name],
    retrigger: true,
  }));
  const extras: Suggestion[] = s.stack.at(-1)?.kind === "fn" ? [] : [kw("NOT", "negate a condition"), { label: "( … )", insert: "(", kind: "operator", detail: "group conditions", retrigger: true }];

  const rootMatches = roots.filter((r) => !p || r.label.startsWith(p));
  const fnMatches = functions.filter((f) => !p || f.label.startsWith(p));
  const extraMatches = keywordMatch(extras, prefix).filter((e) => !p || e.label.toLowerCase().startsWith(p));
  return [...rootMatches, ...fields.map((f) => fieldItem(f, catalog)), ...fnMatches, ...extraMatches];
}

const FUNCTION_DETAIL: Record<string, string> = {
  lower: "text in lowercase",
  upper: "text in uppercase",
  trim: "text without outer spaces",
  length: "characters, items or keys",
  type: "string, number, boolean, object, array, null",
};

function byPresence(a: FieldStats, b: FieldStats) {
  return b.present - a.present;
}

/** How well `typed` matches a field: its last name first, then anywhere in the path. */
function matchScore(f: FieldStats, typed: string): number {
  const path = f.path.toLowerCase();
  const name = f.segment.replaceAll('"', "").toLowerCase();
  if (path.startsWith(typed)) return 4;
  if (name.startsWith(typed)) return 3;
  if (name.includes(typed)) return 2;
  if (path.includes(typed)) return 1;
  return 0;
}

/** Children of the path being typed (`value.customer.` → `name`, `tags`…). */
function pathItems(path: PathState, catalog: FieldCatalog, prefix: string): Suggestion[] {
  const parent = path.canonical;
  // `items.sku` reaches into every element, like `items[*].sku`.
  const own = (catalog.children.get(parent) ?? []).filter((c) => c.segment !== "[*]");
  const children = own.length > 0 ? own : (catalog.children.get(`${parent}[*]`) ?? []);
  const p = prefix.toLowerCase();

  if (path.open === "bracket") {
    const items: Suggestion[] = [];
    const elements = catalog.fields.get(`${parent}[*]`);
    if (elements || typesOf(catalog.fields.get(parent)).includes("array")) {
      const elementPath = `${parent}[*]`;
      const { suffix } = fieldInsert(elements, catalog, elementPath);
      items.push({ label: "*]", insert: `*]${suffix === " " ? " " : suffix}`, kind: "field", detail: "every element", retrigger: true });
      items.push({ label: "0]", insert: "0]", kind: "field", detail: "first element", retrigger: true });
      items.push({ label: "-1]", insert: "-1]", kind: "field", detail: "last element", retrigger: true });
    }
    for (const child of catalog.children.get(parent) ?? []) {
      if (child.segment === "[*]") continue;
      const name = child.segment.startsWith('"') ? child.segment.slice(1, -1).replaceAll('""', '"') : child.segment;
      items.push({ ...fieldItem(child, catalog, `'${name.replaceAll("'", "''")}']`), label: `'${name}']` });
    }
    return items.slice(0, MAX_ITEMS);
  }

  const named = children.filter((c) => c.segment !== "[*]");
  const unquoted = (c: FieldStats) => c.segment.replaceAll('"', "").toLowerCase();
  const starts = named.filter((c) => unquoted(c).startsWith(p));
  const contains = p ? named.filter((c) => !starts.includes(c) && unquoted(c).includes(p)) : [];
  const items = [...starts, ...contains].map((child) => {
    // Only the part after the dot is replaced; the user's own `[0]` etc. stay as typed.
    const item = fieldItem(child, catalog, child.segment);
    return { ...item, label: child.segment };
  });
  return items.slice(0, MAX_ITEMS);
}

/** Operators that make sense for the left side's types. */
function operatorItems(lhs: Operand | null, catalog: FieldCatalog): Suggestion[] {
  const types = lhsTypes(lhs, catalog);
  const isNull = [kw("IS NULL", "missing or null"), kw("IS NOT NULL", "present")];
  const compare = [
    op("=", "equals"),
    op("!=", "differs (or missing)"),
    op(">", undefined),
    op(">=", undefined),
    op("<", undefined),
    op("<=", undefined),
  ];
  const text = [
    op("=", "equals"),
    op("!=", "differs (or missing)"),
    op("CONTAINS", "has this text"),
    op("LIKE", "pattern: % any text, _ one character"),
    op("ILIKE", "LIKE, ignoring case"),
    inOp(),
    op("NOT LIKE", undefined),
    op("NOT IN", "none of a list"),
  ];
  const range = [op("BETWEEN", "x BETWEEN low AND high"), inOp()];
  const connectors = [kw("AND", "true when the field is truthy"), kw("OR", undefined)];

  const main = types[0];
  if (lhs?.literal) return [...compare, ...text.slice(2)];
  if (main === undefined) return dedupe([...compare, ...text, ...range, ...isNull]);
  if (main === "time" || main === "number") {
    const items = [...compare, ...range, ...isNull];
    return types.includes("string") ? dedupe([...items, ...text]) : items;
  }
  if (main === "boolean") return [op("=", "true or false"), op("!=", undefined), ...isNull, ...connectors];
  if (main === "array") return [op("CONTAINS", "has this element"), ...isNull, op("NOT CONTAINS", undefined)];
  if (main === "object") return [...isNull, op("CONTAINS", "has this text"), op("NOT CONTAINS", undefined)];
  if (main === "null") return [...isNull, ...compare.slice(0, 2)];
  // string
  return dedupe([...text, ...isNull, ...compare.slice(2), ...range.slice(0, 1)]);
}

function dedupe(items: Suggestion[]): Suggestion[] {
  const seen = new Set<string>();
  return items.filter((i) => !seen.has(i.label) && seen.add(i.label));
}

type LhsType = JsonType | "time";

function lhsTypes(lhs: Operand | null, catalog: FieldCatalog): LhsType[] {
  if (!lhs || lhs.literal) return [];
  if (lhs.func === "length") return ["number"];
  if (lhs.func) return ["string"];
  if (lhs.path === "timestamp") return ["time"];
  if (lhs.path === "partition" || lhs.path === "offset") return ["number"];
  return typesOf(catalog.fields.get(lhs.path ?? ""));
}

const TYPE_NAMES = ["string", "number", "boolean", "object", "array", "null"];

function valueItems(s: State, catalog: FieldCatalog, prefix: string, partial: Token | null): Suggestion[] {
  const lhs = s.lhs;
  // Inside a function call (`lower(|`) the argument is a field.
  if (s.stack.at(-1)?.kind === "fn") return operandItems(catalog, prefix, { ...s, expect: "operand" });
  const p = prefix.toLowerCase();
  const end = s.role === "in" ? "" : " ";
  const retrigger = true;
  const items: Suggestion[] = [];

  if (lhs?.func === "type") {
    for (const name of TYPE_NAMES) items.push({ label: `'${name}'`, insert: `'${name}'${end}`, kind: "value", retrigger });
  } else if (lhs?.path === "timestamp" && !lhs.func) {
    items.push(...timeItems(end));
  } else if (lhs?.path) {
    const stats = s.op?.includes("CONTAINS") && typesOf(catalog.fields.get(lhs.path))[0] === "array"
      ? catalog.fields.get(`${lhs.path}[*]`)
      : catalog.fields.get(lhs.path);
    const transform = (v: ValueLike) =>
      typeof v === "string" && lhs.func === "lower" ? v.toLowerCase()
      : typeof v === "string" && lhs.func === "upper" ? v.toUpperCase()
      : typeof v === "string" && lhs.func === "trim" ? v.trim()
      : v;
    const like = s.op?.includes("LIKE");
    const seen = new Set<string>();
    for (const v of stats?.values ?? []) {
      const value = lhs.func === "length" ? null : transform(v.value);
      if (value === null && lhs.func === "length") continue;
      const text = literal(value);
      if (seen.has(text)) continue;
      seen.add(text);
      items.push({ label: text, insert: text + end, kind: "value", retrigger });
      if (like && typeof value === "string" && items.length < 3) {
        // A starter pattern from a real value.
        const stem = value.slice(0, Math.max(1, Math.ceil(value.length / 2)));
        const pattern = literal(`${stem}%`);
        items.push({ label: pattern, insert: pattern + end, kind: "value", detail: "starts with", retrigger });
      }
    }
    const types = typesOf(stats);
    if (types.includes("boolean")) {
      for (const b of ["true", "false"]) if (!seen.has(b)) items.push({ label: b, insert: b + end, kind: "value", retrigger });
    }
  }

  // Filter by what was typed: the text inside an open quote, or a bare word.
  let filtered = items;
  if (p) {
    const inner = (label: string) => label.replace(/^'|'$/g, "").replaceAll("''", "'").toLowerCase();
    const starts = items.filter((i) => inner(i.label).startsWith(p));
    const contains = items.filter((i) => !starts.includes(i) && inner(i.label).includes(p));
    filtered = [...starts, ...contains];
  }
  // A template to type into, when typing hasn't started.
  if (!partial) {
    if (s.op?.includes("LIKE")) filtered.push({ label: "'%…%'", insert: `'%%'${end}`, caret: 2, kind: "value", detail: "contains" });
    else if (lhsTypes(lhs, catalog).includes("string") || !lhs?.path) {
      filtered.push({ label: "'…'", insert: `''${end}`, caret: 1, kind: "value", detail: "text" });
    }
  }
  return filtered;
}

type ValueLike = string | number | boolean | null;

/** Date strings the filter understands, for comparing with `timestamp`. */
function timeItems(end: string): Suggestion[] {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const day = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const minute = (d: Date) => `${day(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  return [
    { label: `'${minute(hourAgo)}'`, detail: "an hour ago" },
    { label: `'${day(now)}'`, detail: "today, local time" },
    { label: `'${day(yesterday)}'`, detail: "yesterday" },
    { label: `'${now.toISOString().slice(0, 19)}Z'`, detail: "now, UTC" },
  ].map((i) => ({ ...i, insert: i.label + end, kind: "value" as const, retrigger: true }));
}

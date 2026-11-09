import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";

import { entriesOf, parseEmbedded, parseTree } from "../json-tree";
import { JsonTree } from "./json-tree";

// Budgets are ~10x what a laptop needs, so they catch accidental quadratic work, not noise.
function timed<T>(fn: () => T): [T, number] {
  const start = performance.now();
  const result = fn();
  return [result, performance.now() - start];
}

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i, tags: ["a", "b"], at: { x: i, y: { z: i } } }));
const rowCount = (html: string) => html.split("fill-mode-backwards").length - 1;
/** The visible text: React's server renderer separates adjacent text pieces with comment markers. */
const text = (html: string) => html.replace(/<!-- -->/g, "");

describe("tree parsing", () => {
  test("a 5 MB document parses quickly", () => {
    const text = JSON.stringify(rows(90_000));
    expect(text.length).toBeGreaterThan(5_000_000);
    const [tree, ms] = timed(() => parseTree(text));
    expect(Array.isArray(tree) && tree.length).toBe(90_000);
    expect(ms).toBeLessThan(1000);
  });

  test("a 1 MB JSON string unwraps quickly, and nested encodings stay linear", () => {
    const inner = JSON.stringify(rows(12_000));
    const [, once] = timed(() => parseEmbedded(inner));
    const [, thrice] = timed(() => parseEmbedded(JSON.stringify(JSON.stringify(inner))));
    expect(once).toBeLessThan(500);
    expect(thrice).toBeLessThan(1500);
  });

  test("listing the children of a 100,000-item array", () => {
    const [entries, ms] = timed(() => entriesOf(Array.from({ length: 100_000 }, (_, i) => i)));
    expect(entries).toHaveLength(100_000);
    expect(ms).toBeLessThan(500);
  });
});

describe("tree rendering", () => {
  test("a 100,000-item array renders one page of rows, not all of them", () => {
    const json = JSON.stringify(Array.from({ length: 100_000 }, (_, i) => i));
    const [html, ms] = timed(() => renderToString(<JsonTree text={json} />));
    expect(rowCount(html)).toBe(100);
    expect(text(html)).toContain("99900 left");
    expect(ms).toBeLessThan(1500);
  });

  test("the default view renders only the open levels, however large the document", () => {
    // 50 x 50 keys, each holding 50 objects: ~125,000 nodes if fully expanded. By default the root and
    // its children are open, so only their 2,550 rows exist; everything deeper is never rendered.
    const deep = Object.fromEntries(
      Array.from({ length: 50 }, (_, a) => [
        `a${a}`,
        Object.fromEntries(Array.from({ length: 50 }, (_, b) => [`b${b}`, rows(50)])),
      ]),
    );
    const [html, ms] = timed(() => renderToString(<JsonTree text={JSON.stringify(deep)} />));
    expect(rowCount(html)).toBeLessThan(3000);
    expect(html).not.toContain("tags");
    expect(ms).toBeLessThan(1500);
  });

  test("JSON strings are not parsed until their node renders", () => {
    // 2,000 string values each holding ~10 KB of JSON; collapsed, none of them may be parsed.
    const blob = JSON.stringify(rows(150));
    const json = JSON.stringify({ outer: Object.fromEntries(Array.from({ length: 2000 }, (_, i) => [`k${i}`, blob])) });
    const [html, ms] = timed(() => renderToString(<JsonTree text={json} />));
    expect(html).toContain("k0");
    expect(ms).toBeLessThan(1500);
  });
});

describe("tree robustness", () => {
  test("broken JSON strings render as text with an invalid-JSON badge, and don't throw", () => {
    const json = JSON.stringify({ ok: '{"a":1}', truncated: '{"a":{"b":[1,2', prose: "[INFO] started" });
    const html = renderToString(<JsonTree text={json} />).replace(/<!-- -->/g, "");
    expect(html.match(/invalid json/g)).toHaveLength(1);
    expect(html).toContain("truncated");
  });
});

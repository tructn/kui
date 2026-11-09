import { describe, expect, test } from "bun:test";

import { describeSize, entriesOf, inspectEmbedded, parseEmbedded, parseTree } from "./json-tree";

describe("parseEmbedded", () => {
  test("unwraps objects and arrays written as strings", () => {
    expect(parseEmbedded('{"a":{"b":[1,2]}}')).toEqual({ a: { b: [1, 2] } });
    expect(parseEmbedded(' [1, "x"] ')).toEqual([1, "x"]);
    expect(parseEmbedded('{\n  "name": "Nguyễn"\n}')).toEqual({ name: "Nguyễn" });
  });

  test("unwraps strings encoded more than once", () => {
    const once = JSON.stringify({ a: 1 });
    const twice = JSON.stringify(once);
    const thrice = JSON.stringify(twice);
    expect(parseEmbedded(twice)).toEqual({ a: 1 });
    expect(parseEmbedded(thrice)).toEqual({ a: 1 });
  });

  test("leaves scalars and things that only look like JSON alone", () => {
    for (const s of ["42", "true", "null", '"plain"', "[INFO] started", "{draft", '{"a":{"b":[1,2', "", "  "]) {
      expect(parseEmbedded(s)).toBeUndefined();
    }
  });
});

describe("inspectEmbedded", () => {
  test("flags JSON that is broken, with the parser's message", () => {
    for (const s of ['{"a":{"b":[1,2', '{"a":1,}', '{"a":"unescaped "quote""}', "[1,2,", '{"a":1} trailing']) {
      const r = inspectEmbedded(s);
      expect(r.kind).toBe("broken");
      expect(r.kind === "broken" && r.error.length).toBeGreaterThan(0);
    }
  });

  test("a double-encoded string whose inner JSON is broken is broken too", () => {
    expect(inspectEmbedded(JSON.stringify('{"a":'))).toEqual({ kind: "broken", error: expect.any(String) });
  });

  test("prose that merely starts with a bracket is text, not broken JSON", () => {
    for (const s of ["[INFO] started", "{draft", "[ERROR] x", "{ not json }", "[abc]", '"just a string"']) {
      expect(inspectEmbedded(s)).toEqual({ kind: "text" });
    }
  });

  test("valid JSON is still unwrapped", () => {
    expect(inspectEmbedded('{"a":1}')).toEqual({ kind: "json", value: { a: 1 } });
  });
});

describe("parseTree", () => {
  test("objects, arrays, and a string holding either", () => {
    expect(parseTree('{"a":1}')).toEqual({ a: 1 });
    expect(parseTree("[1]")).toEqual([1]);
    expect(parseTree(JSON.stringify('{"a":1}'))).toEqual({ a: 1 });
  });

  test("no tree for scalars, plain strings or text that isn't JSON", () => {
    for (const s of ["42", "null", '"hello"', "INFO heartbeat ok", ""]) expect(parseTree(s)).toBeUndefined();
  });
});

describe("entriesOf / describeSize", () => {
  test("labels arrays by index and objects by key", () => {
    expect(entriesOf(["a", "b"])).toEqual([[0, "a"], [1, "b"]]);
    expect(entriesOf({ x: 1, "y z": null })).toEqual([["x", 1], ["y z", null]]);
  });

  test("pluralises", () => {
    expect(describeSize({})).toBe("0 keys");
    expect(describeSize({ a: 1 })).toBe("1 key");
    expect(describeSize([1, 2])).toBe("2 items");
  });
});

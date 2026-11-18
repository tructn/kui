import { describe, expect, it } from "bun:test";

import {
  contextOf,
  describeValue,
  fieldTree,
  formatSample,
  keyFor,
  listPaths,
  resolvePath,
  sampleOf,
  withItem,
} from "./sample-fields";

const context = contextOf(
  {
    value: JSON.stringify({ id: 7, customer: { name: "Ada" }, items: [{ sku: "a", parts: [{ n: 1 }] }, { sku: "b" }] }),
    key: "k-1",
    headers: [{ name: "x.source", value: "web" }],
  },
  "orders",
);

describe("resolvePath", () => {
  it("reads the sample like the backend does", () => {
    expect(resolvePath("value.customer.name", context)).toBe("Ada");
    expect(resolvePath("value.items.1.sku", context)).toBe("b");
    expect(resolvePath("headers.x.source", context)).toBe("web");
    expect(resolvePath("key", context)).toBe("k-1");
    expect(resolvePath("topic", context)).toBe("orders");
    expect(resolvePath("value.nope.deeper", context)).toBeUndefined();
  });

  it("reads item as the first item of each list in scope", () => {
    const inner = withItem(context, ["value.items", "item.parts"]);
    expect(resolvePath("item.n", inner)).toBe(1);
    expect(resolvePath("item.sku", withItem(context, ["value.items"]))).toBe("a");
  });
});

describe("fieldTree", () => {
  it("offers objects as branches and lists whole", () => {
    const roots = fieldTree(context, false);
    expect(roots.map((n) => n.name)).toEqual(["value", "key", "headers", "topic", "partition", "offset", "timestamp"]);
    const value = roots[0];
    expect(value?.children.map((n) => n.path)).toEqual(["value.id", "value.customer", "value.items"]);
    expect(value?.children[2]?.children).toEqual([]);
  });

  it("puts item first inside a list", () => {
    const roots = fieldTree(withItem(context, ["value.items"]), true);
    expect(roots[0]?.children.map((n) => n.path)).toEqual(["item.sku", "item.parts"]);
  });

  it("stops at a few hundred fields", () => {
    const wide = contextOf({ value: JSON.stringify(Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`f${i}`, i]))), key: "", headers: [] }, "t");
    expect(fieldTree(wide, false)[0]?.children.length).toBe(300);
  });
});

describe("listPaths", () => {
  it("finds lists in objects but not inside lists", () => {
    expect(listPaths(context)).toEqual(["value.items"]);
    expect(listPaths(contextOf({ value: "[1,2]", key: "", headers: [] }, "t"))).toEqual(["value"]);
  });
});

describe("describeValue", () => {
  it("keeps it short", () => {
    expect(describeValue([1, 2])).toBe("2 items");
    expect(describeValue({ a: 1 })).toBe("{…}");
    expect(describeValue("x".repeat(60))).toHaveLength(40);
    expect(describeValue(null)).toBe("null");
    expect(describeValue(undefined)).toBe("");
  });
});

describe("keyFor", () => {
  it("uses the last part of the path and never reuses a name", () => {
    expect(keyFor("value.customer.name", [])).toBe("name");
    expect(keyFor("headers.x-source", [])).toBe("x-source");
    expect(keyFor("value.id", ["id", "id_2"])).toBe("id_3");
  });
});

describe("sampleOf", () => {
  const text = (t: string) => ({ text: t, encoding: "utf8" });
  it("takes text values and drops binary keys and empty headers", () => {
    const message = { key: { text: "00ff", encoding: "hex" }, value: text("{}"), headers: [{ key: "a", value: "1" }, { key: "b", value: null }] };
    expect(sampleOf(message)).toEqual({ value: "{}", key: "", headers: [{ name: "a", value: "1" }] });
  });

  it("has no sample for a binary value or no message", () => {
    expect(sampleOf({ key: null, value: { text: "00", encoding: "hex" }, headers: [] })).toBeNull();
    expect(sampleOf(undefined)).toBeNull();
  });
});

describe("formatSample", () => {
  it("indents JSON and leaves other text alone", () => {
    expect(formatSample('{"a":1}')).toBe('{\n  "a": 1\n}');
    expect(formatSample("plain")).toBe("plain");
  });
});

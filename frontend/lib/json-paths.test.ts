import { describe, expect, it } from "bun:test";

import { leafPaths } from "./json-paths";

describe("leafPaths", () => {
  it("lists every leaf with its dotted path", () => {
    expect(leafPaths({ id: 7, customer: { name: "Ada", tags: ["a", "b"] }, note: null })).toEqual([
      "id",
      "customer.name",
      "customer.tags.0",
      "customer.tags.1",
      "note",
    ]);
  });

  it("samples the first few array items and stops at the limit", () => {
    expect(leafPaths({ xs: [1, 2, 3, 4, 5] })).toEqual(["xs.0", "xs.1", "xs.2"]);
    expect(leafPaths({ a: 1, b: 2, c: 3 }, 2)).toEqual(["a", "b"]);
  });

  it("treats empty containers as leaves and a bare scalar as having no paths", () => {
    expect(leafPaths({ a: {}, b: [] })).toEqual(["a", "b"]);
    expect(leafPaths(42)).toEqual([]);
    expect(leafPaths("text")).toEqual([]);
  });
});

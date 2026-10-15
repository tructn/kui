import { describe, expect, test } from "bun:test";

import { matchByName } from "./name-search";

const names = (items: readonly { name: string }[]) => items.map((i) => i.name);
const topics = ["demo.orders", "orders", "payments", "Orders-dlq", "audit"].map((name) => ({ name }));

describe("matchByName", () => {
  test("puts names starting with the query before names containing it", () => {
    expect(names(matchByName(topics, "orders"))).toEqual(["orders", "Orders-dlq", "demo.orders"]);
  });

  test("ignores case and surrounding spaces", () => {
    expect(names(matchByName(topics, "  ORD "))).toEqual(["orders", "Orders-dlq", "demo.orders"]);
  });

  test("matches everything for an empty query and nothing for an unknown one", () => {
    expect(matchByName(topics, "")).toBe(topics);
    expect(matchByName(topics, "nope")).toEqual([]);
  });
});

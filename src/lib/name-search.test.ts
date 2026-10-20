import { describe, expect, test } from "bun:test";

import { matchByName, nameFilter } from "./name-search";

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

describe("nameFilter", () => {
  const filter = (query: string, regex: boolean) =>
    names(topics.filter((t) => nameFilter(query, regex).matches(t.name)));

  test("matches a substring, ignoring case, when regex is off", () => {
    expect(filter("ORDERS", false)).toEqual(["demo.orders", "orders", "Orders-dlq"]);
    expect(filter("^orders", false)).toEqual([]);
  });

  test("matches a regular expression anywhere in the name, ignoring case", () => {
    expect(filter("^orders", true)).toEqual(["orders", "Orders-dlq"]);
    expect(filter("s$", true)).toEqual(["demo.orders", "orders", "payments"]);
    expect(filter("pay|audit", true)).toEqual(["payments", "audit"]);
  });

  test("matches everything for an empty query", () => {
    expect(filter("", true)).toEqual(names(topics));
  });

  test("reports an invalid regular expression and matches nothing", () => {
    const f = nameFilter("orders(", true);
    expect(f.error).not.toBeNull();
    expect(f.matches("orders(")).toBe(false);
    expect(nameFilter("orders(", false).error).toBeNull();
  });
});

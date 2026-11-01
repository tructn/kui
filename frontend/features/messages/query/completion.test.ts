import { describe, expect, test } from "bun:test";

import type { KafkaMessage } from "../types";
import { buildCatalog, describeField } from "./catalog";
import { complete } from "./completion";

let offset = 0;
function msg(value: unknown, headers: Record<string, string> = {}, key: string | null = null): KafkaMessage {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return {
    partition: 0,
    offset: offset++,
    timestamp: 1_790_000_000_000,
    key: key === null ? null : { text: key, encoding: "utf8", size: key.length },
    value: { text, encoding: "utf8", size: text.length },
    headers: Object.entries(headers).map(([k, v]) => ({ key: k, value: v })),
  };
}

// Two event shapes share the topic, as they often do.
const catalog = buildCatalog([
  msg({ type: "order", status: "shipped", total: 10.5, customer: { name: "Ada", tags: ["vip"] }, items: [{ sku: "A-1" }] }, { "x-source": "web" }, "o-1"),
  msg({ type: "order", status: "pending", total: 3, customer: { name: "Bob", tags: [] }, items: [{ sku: "B-2" }] }, { "x-source": "ios" }, "o-2"),
  msg({ type: "order", status: "shipped", total: 7, customer: { name: "Cy", tags: ["eu"] }, items: [] }, {}, "o-3"),
  msg({ type: "refund", amount: 4, "first name": "Di", paid: true, meta: '{"source":"web"}' }),
]);

const labels = (text: string, caret = text.length) => complete(text, caret, catalog).items.map((i) => i.label);

describe("buildCatalog", () => {
  test("records each field's types, presence and common values", () => {
    const status = catalog.fields.get("value.status")!;
    expect(status.present).toBe(3);
    expect(status.values[0]).toEqual({ value: "shipped", count: 2 });
    expect(describeField(status)).toBe("string");
    expect(describeField(catalog.fields.get("value.type")!)).toBe("string");
    expect(catalog.fields.get("value.items[*].sku")?.values.length).toBe(2);
    expect(catalog.fields.has('value."first name"')).toBe(true);
    // JSON inside a string is walked, like the Rust filter does.
    expect(catalog.fields.get("value.meta.source")?.values[0].value).toBe("web");
    expect(catalog.fields.get("headers.x-source")?.present).toBe(2);
  });
});

describe("complete", () => {
  test("starts with the message attributes and common fields", () => {
    const items = labels("");
    expect(items.slice(0, 6)).toEqual(["key", "value", "headers", "partition", "offset", "timestamp"]);
    expect(items).toContain("value.status");
    expect(items).toContain("lower( )");
  });

  test("finds nested fields by name alone", () => {
    expect(labels("nam")[0]).toBe("value.customer.name");
    expect(labels("sku")).toContain("value.items[*].sku");
  });

  test("lists the children of the path being typed", () => {
    expect(labels("value.customer.")).toEqual(["name", "tags"]);
    // Prefix matches first, then names containing the text.
    expect(labels("value.st")).toEqual(["status", "customer", '"first name"']);
    expect(labels("value.items[0].")).toEqual(["sku"]);
    expect(labels("value.items.")).toEqual(["sku"]);
    expect(labels("headers.")).toEqual(["x-source"]);
    expect(labels("value.meta.")).toEqual(["source"]);
    // Only the typed part is replaced, so the user's [0] stays.
    const c = complete("value.items[0].s", 16, catalog);
    expect(c.from).toBe(15);
  });

  test("steps into objects and arrays of objects", () => {
    const customer = complete("cust", 4, catalog).items.find((i) => i.label === "value.customer");
    expect(customer?.insert).toBe("value.customer.");
    const items = complete("value.it", 8, catalog).items[0];
    expect(items.insert).toBe("items[*].");
  });

  test("offers operators that fit the field's type", () => {
    expect(labels("value.status ")).toContain("LIKE");
    expect(labels("value.total ")).toContain("BETWEEN");
    expect(labels("value.total ")).not.toContain("LIKE");
    expect(labels("value.customer.tags ")[0]).toBe("CONTAINS");
    expect(labels("value.paid ")).toContain("AND");
    expect(labels("value.status li")).toEqual(["LIKE", "ILIKE", "NOT LIKE"]);
    expect(labels("value.status IS ")).toEqual(["NULL", "NOT NULL"]);
  });

  test("suggests values that occur, most common first", () => {
    expect(labels("value.status = ").slice(0, 2)).toEqual(["'shipped'", "'pending'"]);
    expect(labels("value.status = 'pe")).toEqual(["'pending'", "'shipped'"]);
    expect(labels("value.customer.tags CONTAINS ")).toEqual(["'vip'", "'eu'"]);
    expect(labels("value.status IN ('shipped', ")).toContain("'pending'");
    expect(labels("type(value.total) = ")).toContain("'number'");
    expect(labels("lower(value.customer.name) = ")).toContain("'ada'");
    expect(labels("timestamp > ")[0]).toMatch(/^'\d{4}-\d\d-\d\d \d\d:\d\d'$/);
  });

  test("continues after a complete condition", () => {
    expect(labels("value.status = 'shipped' ")).toEqual(["AND", "OR"]);
    expect(labels("(value.total > 3 ")).toContain(")");
    expect(labels("offset BETWEEN 1 ")).toEqual(["AND"]);
    expect(labels("value.status = 'shipped' AND ")).toContain("value.total");
  });

  test("says nothing it can't place", () => {
    expect(labels("value.status = = ")).toEqual([]);
  });
});

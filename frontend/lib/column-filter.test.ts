import { describe, expect, test } from "bun:test";

import { activeFilterCount, applyColumnFilters, isFilterActive, type FilterColumns } from "./column-filter";

interface Row {
  key: string;
  status: string;
}

const rows: Row[] = [
  { key: "order-1", status: "succeeded" },
  { key: "ORDER-2", status: "failed" },
  { key: "refund-3", status: "timedOut" },
];
const columns: FilterColumns<Row, "key" | "status"> = { key: (r) => r.key, status: (r) => r.status };

describe("applyColumnFilters", () => {
  test("no filters keep every row", () => {
    expect(applyColumnFilters(rows, columns, {})).toBe(rows);
  });

  test("text filters match anywhere, ignoring case and surrounding spaces", () => {
    const out = applyColumnFilters(rows, columns, { key: { kind: "text", text: " order " } });
    expect(out.map((r) => r.key)).toEqual(["order-1", "ORDER-2"]);
  });

  test("option filters keep any picked value", () => {
    const out = applyColumnFilters(rows, columns, { status: { kind: "options", values: ["failed", "timedOut"] } });
    expect(out.map((r) => r.key)).toEqual(["ORDER-2", "refund-3"]);
  });

  test("filters on several columns all apply", () => {
    const out = applyColumnFilters(rows, columns, {
      key: { kind: "text", text: "order" },
      status: { kind: "options", values: ["failed"] },
    });
    expect(out.map((r) => r.key)).toEqual(["ORDER-2"]);
  });
});

test("empty filters are inactive and don't count", () => {
  expect(isFilterActive({ kind: "text", text: "  " })).toBe(false);
  expect(isFilterActive({ kind: "options", values: [] })).toBe(false);
  expect(isFilterActive(undefined)).toBe(false);
  expect(
    activeFilterCount({ key: { kind: "text", text: "" }, status: { kind: "options", values: ["failed"] } }),
  ).toBe(1);
});

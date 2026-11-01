import { describe, expect, test } from "bun:test";

import { paginate } from "./pagination";

const rows = Array.from({ length: 23 }, (_, i) => i + 1);

describe("paginate", () => {
  test("slices one page and reports the row range", () => {
    const p = paginate(rows, 1, 10);
    expect(p.items).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    expect([p.page, p.pageCount, p.from, p.to, p.total]).toEqual([1, 3, 11, 20, 23]);
  });

  test("the last page may be short", () => {
    const p = paginate(rows, 2, 10);
    expect(p.items).toEqual([21, 22, 23]);
    expect([p.from, p.to]).toEqual([21, 23]);
  });

  test("a page past the end snaps to the last page (e.g. after rows were deleted)", () => {
    expect(paginate(rows, 9, 10).page).toBe(2);
    expect(paginate(rows, -3, 10).page).toBe(0);
  });

  test("an empty list is one empty page", () => {
    const p = paginate([], 4, 25);
    expect([p.page, p.pageCount, p.from, p.to, p.total, p.items.length]).toEqual([0, 1, 0, 0, 0, 0]);
  });

  test("a nonsense page size still yields pages", () => {
    expect(paginate(rows, 0, 0).items).toEqual([1]);
  });
});

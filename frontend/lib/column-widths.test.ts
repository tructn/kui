import { describe, expect, test } from "bun:test";

import {
  displayOrder,
  MAX_PINNED_TABLES,
  measuredWidths,
  MIN_COLUMN_WIDTH,
  permute,
  pinKey,
  pinnedColumnsCss,
  pinnedOffsets,
  resizeColumn,
  togglePinned,
  unpermute,
  withPins,
} from "./column-widths";

const sum = (widths: number[]) => widths.reduce((a, b) => a + b, 0);

describe("resizeColumn", () => {
  const layout = { column: 1, px: [40, 500, 100, 100], available: 740 };

  test("widening changes only that column, and the table grows past its box", () => {
    const next = resizeColumn(layout, 200);
    expect(next).toEqual([40, 700, 100, 100]);
    expect(sum(next)).toBe(940); // wider than the 740px box: scrolls sideways
  });

  test("narrowing a table that fits gives the gap to the next column", () => {
    const next = resizeColumn(layout, -150);
    expect(next).toEqual([40, 350, 250, 100]);
    expect(sum(next)).toBe(740); // still fills the box
  });

  test("narrowing a table wider than its box shrinks the table first", () => {
    const wide = { column: 1, px: [40, 700, 100, 100], available: 740 };
    expect(resizeColumn(wide, -150)).toEqual([40, 550, 100, 100]); // 790: still scrolls
    expect(resizeColumn(wide, -300)).toEqual([40, 400, 200, 100]); // 100px gap to the neighbour
  });

  test("the last column hands a gap to the column before it", () => {
    const last = { column: 3, px: [40, 500, 100, 100], available: 740 };
    expect(resizeColumn(last, 300)).toEqual([40, 500, 100, 400]);
    expect(resizeColumn(last, -40)).toEqual([40, 500, 140, 60]);
  });

  test("a column never gets narrower than the minimum", () => {
    const next = resizeColumn(layout, -1000);
    expect(next[1]).toBe(MIN_COLUMN_WIDTH);
    expect(sum(next)).toBe(740);
  });
});

describe("togglePinned", () => {
  test("adds a column after the ones pinned before it, and removes it again", () => {
    expect(togglePinned([3], 1)).toEqual([3, 1]);
    expect(togglePinned([3, 1], 3)).toEqual([1]);
  });
});

describe("displayOrder", () => {
  test("pinned columns move to the front in the order they were pinned", () => {
    expect(displayOrder(5, [3, 1])).toEqual([3, 1, 0, 2, 4]);
  });

  test("no pins keep the usual order", () => {
    expect(displayOrder(3, [])).toEqual([0, 1, 2]);
  });

  test("ignores pins the table doesn't have, and repeats", () => {
    expect(displayOrder(3, [-1, 2, 9, 2])).toEqual([2, 0, 1]);
  });
});

describe("permute", () => {
  const order = [3, 1, 0, 2];

  test("puts per-column values in display order", () => {
    expect(permute(["a", "b", "c", "d"], order)).toEqual(["d", "b", "a", "c"]);
  });

  test("unpermute undoes it", () => {
    expect(unpermute(permute([10, 20, 30, 40], order), order)).toEqual([10, 20, 30, 40]);
  });
});

describe("pinKey", () => {
  test("tables of one kind showing different data get different keys", () => {
    expect(pinKey("partitions", ["c1", "orders"])).not.toBe(pinKey("partitions", ["c1", "payments"]));
  });

  test("names holding the separator can't collide", () => {
    expect(pinKey("t", ["a", "b"])).not.toBe(pinKey("t", ["a,b"]));
    expect(pinKey("t", ['a","b'])).not.toBe(pinKey("t", ["a", "b"]));
  });
});

describe("withPins", () => {
  test("sets one table's pins and leaves the others alone", () => {
    expect(withPins({ a: [1] }, "b", [2])).toEqual({ a: [1], b: [2] });
  });

  test("empty or null pins drop the table", () => {
    expect(withPins({ a: [1], b: [2] }, "a", [])).toEqual({ b: [2] });
    expect(withPins({ a: [1] }, "a", null)).toEqual({});
  });

  test("forgets the tables pinned longest ago past the cap", () => {
    let saved: Record<string, number[]> = {};
    for (let i = 0; i <= MAX_PINNED_TABLES; i++) saved = withPins(saved, `t${i}`, [0]);
    saved = withPins(saved, "t1", [2]); // re-pinning makes it the newest
    const keys = Object.keys(saved);
    expect(keys).toHaveLength(MAX_PINNED_TABLES);
    expect(keys).not.toContain("t0");
    expect(keys.at(-1)).toBe("t1");
  });
});

describe("pinnedOffsets", () => {
  test("the pinned columns at the front stack by the widths before them", () => {
    expect(pinnedOffsets([40, 100, 200, 300], 3)).toEqual([0, 40, 140]);
  });

  test("never more offsets than columns", () => {
    expect(pinnedOffsets([40], 3)).toEqual([0]);
  });
});

describe("measuredWidths", () => {
  test("rounds, and gives a column squeezed to nothing the minimum width so the widths stay valid", () => {
    expect(measuredWidths([40.4, 95.6, 0, 0.3])).toEqual([40, 96, MIN_COLUMN_WIDTH, MIN_COLUMN_WIDTH]);
  });
});

describe("pinnedColumnsCss", () => {
  test("no pins, no rules", () => {
    expect(pinnedColumnsCss("t", [40, 100], 0)).toBe("");
  });

  test("makes each leading column sticky at its offset, skipping spanning cells", () => {
    const css = pinnedColumnsCss("t", [40, 100, 200], 2);
    expect(css).toContain('[data-pin-scope="t"] tr > :is(th, td):nth-child(1):not([colspan]) { position: sticky; left: 0px;');
    expect(css).toContain(':nth-child(2):not([colspan]) { position: sticky; left: 40px;');
    expect(css).not.toContain("nth-child(3)");
  });

  test("only the last pinned column draws the divider", () => {
    const css = pinnedColumnsCss("t", [40, 100, 200], 2);
    const divider = css.split("\n").filter((rule) => rule.includes("inset -1px 0 0"));
    expect(divider).toHaveLength(2); // its header cell and its body cells
    expect(divider.every((rule) => rule.includes("nth-child(2)"))).toBe(true);
  });
});

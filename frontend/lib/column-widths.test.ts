import { describe, expect, test } from "bun:test";

import { MIN_COLUMN_WIDTH, pinnedColumnsCss, pinnedOffsets, resizeColumn, togglePinned } from "./column-widths";

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
  test("adds a column in column order, and removes it again", () => {
    expect(togglePinned([3], 1)).toEqual([1, 3]);
    expect(togglePinned([1, 3], 3)).toEqual([1]);
  });
});

describe("pinnedOffsets", () => {
  const widths = [40, 100, 200, 300];

  test("pinned columns stack by the widths of the pinned columns before them", () => {
    expect(pinnedOffsets(widths, [0, 2, 3])).toEqual(new Map([[0, 0], [2, 40], [3, 240]]));
  });

  test("a lone pinned column sticks to the left edge wherever it is", () => {
    expect(pinnedOffsets(widths, [2])).toEqual(new Map([[2, 0]]));
  });

  test("ignores columns the table doesn't have", () => {
    expect(pinnedOffsets(widths, [-1, 1, 9])).toEqual(new Map([[1, 0]]));
  });
});

describe("pinnedColumnsCss", () => {
  test("no pins, no rules", () => {
    expect(pinnedColumnsCss("t", [40, 100], [])).toBe("");
  });

  test("makes each pinned column sticky at its offset, skipping spanning cells", () => {
    const css = pinnedColumnsCss("t", [40, 100, 200], [0, 2]);
    expect(css).toContain('[data-pin-scope="t"] tr > :is(th, td):nth-child(1):not([colspan]) { position: sticky; left: 0px;');
    expect(css).toContain(':nth-child(3):not([colspan]) { position: sticky; left: 40px;');
    expect(css).not.toContain("nth-child(2)");
  });

  test("only the last pinned column draws the divider", () => {
    const css = pinnedColumnsCss("t", [40, 100, 200], [0, 2]);
    const divider = css.split("\n").filter((rule) => rule.includes("inset -1px 0 0"));
    expect(divider).toHaveLength(2); // its header cell and its body cells
    expect(divider.every((rule) => rule.includes("nth-child(3)"))).toBe(true);
  });
});

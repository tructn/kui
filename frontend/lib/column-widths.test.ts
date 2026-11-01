import { describe, expect, test } from "bun:test";

import { MIN_COLUMN_WIDTH, resizeColumn } from "./column-widths";

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

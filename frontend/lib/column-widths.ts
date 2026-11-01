/** Narrowest a column can be resized to, in px. */
export const MIN_COLUMN_WIDTH = 48;

export interface ColumnLayout {
  /** The column whose right edge is dragged. */
  column: number;
  /** Every column's current width in px. */
  px: number[];
  /** Width of the box the table sits in. */
  available: number;
}

/**
 * Widths after dragging `column`'s right edge by `delta` px. Only that column
 * changes, unless the table would end up narrower than `available`; then the
 * neighbouring column (the next one, or the previous one for the last column)
 * takes up the gap, so the table always fills its box.
 */
export function resizeColumn({ column, px, available }: ColumnLayout, delta: number): number[] {
  const next = [...px];
  next[column] = Math.max(MIN_COLUMN_WIDTH, px[column] + delta);
  const gap = available - next.reduce((a, b) => a + b, 0);
  if (gap > 0) {
    const neighbour = column < next.length - 1 ? column + 1 : column - 1;
    if (neighbour >= 0) next[neighbour] += gap;
  }
  return next.map(Math.round);
}

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

/** `pinned` with `column` added or removed, in column order. */
export function togglePinned(pinned: readonly number[], column: number): number[] {
  const next = pinned.includes(column) ? pinned.filter((c) => c !== column) : [...pinned, column];
  return next.sort((a, b) => a - b);
}

/**
 * How far from the frame's left edge each pinned column sticks: the summed
 * widths of the pinned columns before it, so pinned columns stack instead of
 * overlapping. Unpinned columns in between scroll away underneath.
 */
export function pinnedOffsets(widths: readonly number[], pinned: readonly number[]): Map<number, number> {
  const offsets = new Map<number, number>();
  let left = 0;
  for (const column of [...pinned].sort((a, b) => a - b)) {
    if (column < 0 || column >= widths.length) continue;
    offsets.set(column, left);
    left += widths[column];
  }
  return offsets;
}

/**
 * A stylesheet making the pinned columns of the table marked
 * `data-pin-scope="<scope>"` stick while it scrolls sideways.
 *
 * Cells are matched by position, so no cell has to know its column. Cells with
 * a `colspan` (empty states, expanded previews) span the whole table and stay
 * out of it. Sticky cells need an opaque background, or the cells scrolling
 * under them show through: body cells paint the row's tint over the page
 * background, and the last pinned column draws a divider on its right edge.
 */
export function pinnedColumnsCss(scope: string, widths: readonly number[], pinned: readonly number[]): string {
  const offsets = pinnedOffsets(widths, pinned);
  const last = Math.max(-1, ...offsets.keys());
  const table = `[data-pin-scope="${scope}"]`;
  const rules: string[] = [];
  for (const [column, left] of offsets) {
    const nth = `:nth-child(${column + 1}):not([colspan])`;
    const edge = column === last;
    rules.push(
      `${table} tr > :is(th, td)${nth} { position: sticky; left: ${left}px; z-index: 1; }`,
      `${table} thead th${nth} { background-color: var(--color-background);${
        edge ? " box-shadow: inset 0 -1px 0 var(--color-border), inset -1px 0 0 var(--color-border);" : ""
      } }`,
      `${table} tbody td${nth} { background: linear-gradient(var(--row-tint, transparent), var(--row-tint, transparent)), var(--color-background);${
        edge ? " box-shadow: inset -1px 0 0 var(--color-border);" : ""
      } }`,
    );
  }
  return rules.join("\n");
}

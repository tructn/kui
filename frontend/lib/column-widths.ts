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

/**
 * Measured cell widths, rounded, as widths to save. A column without a width
 * class can be squeezed to 0px under `table-fixed` once the others fill the
 * frame; saved as is, the widths would be rejected and pins silently dropped.
 */
export function measuredWidths(px: readonly number[]): number[] {
  return px.map((w) => (w >= 1 ? Math.round(w) : MIN_COLUMN_WIDTH));
}

/** `pinned` with `column` added at the end or removed, keeping the order columns were pinned in. */
export function togglePinned(pinned: readonly number[], column: number): number[] {
  return pinned.includes(column) ? pinned.filter((c) => c !== column) : [...pinned, column];
}

/**
 * Which column is shown in each slot: the pinned ones first, in the order they
 * were pinned, then the rest in their usual order. Pins the table doesn't have
 * (saved for an older layout) are skipped.
 */
export function displayOrder(columnCount: number, pinned: readonly number[]): number[] {
  const front = validPins(columnCount, pinned);
  const rest = Array.from({ length: columnCount }, (_, c) => c).filter((c) => !front.includes(c));
  return [...front, ...rest];
}

/** `pinned` without repeats or columns the table doesn't have, in pin order. */
export function validPins(columnCount: number, pinned: readonly number[]): number[] {
  return [...new Set(pinned.filter((c) => Number.isInteger(c) && c >= 0 && c < columnCount))];
}

/** `items` (one per column) in display order. */
export function permute<T>(items: readonly T[], order: readonly number[]): T[] {
  return order.map((column) => items[column]);
}

/** Inverse of `permute`: `items` in display order back to column order. */
export function unpermute<T>(items: readonly T[], order: readonly number[]): T[] {
  const out = [...items];
  order.forEach((column, slot) => {
    out[column] = items[slot];
  });
  return out;
}

/**
 * Where one table's pins are saved: its kind plus whatever names the data it
 * shows (cluster, topic, group), so pinning a column in one topic's table
 * leaves every other topic's table alone. JSON, because group names may hold
 * any separator.
 */
export function pinKey(tableId: string, scope: readonly string[]): string {
  return JSON.stringify([tableId, ...scope]);
}

/** Tables whose pins are remembered; one per topic or group pinned would otherwise grow without bound. */
export const MAX_PINNED_TABLES = 200;

/**
 * `saved` with `key`'s pins replaced (or dropped when `pinned` is empty). The
 * changed table moves to the end, and the tables pinned longest ago are
 * forgotten past `MAX_PINNED_TABLES`.
 */
export function withPins(
  saved: Readonly<Record<string, number[]>>,
  key: string,
  pinned: readonly number[] | null,
): Record<string, number[]> {
  const entries = Object.entries(saved).filter(([k]) => k !== key);
  if (pinned?.length) entries.push([key, [...pinned]]);
  return Object.fromEntries(entries.slice(-MAX_PINNED_TABLES));
}

/**
 * How far from the frame's left edge each of the first `count` columns sticks:
 * the summed widths of the columns before it, so pinned columns stack.
 */
export function pinnedOffsets(widths: readonly number[], count: number): number[] {
  const offsets: number[] = [];
  let left = 0;
  for (const width of widths.slice(0, count)) {
    offsets.push(left);
    left += width;
  }
  return offsets;
}

/**
 * A stylesheet making the first `count` columns (the pinned ones; see
 * `displayOrder`) of the table marked `data-pin-scope="<scope>"` stick while
 * it scrolls sideways. `widths` are in display order.
 *
 * Cells are matched by position, so no cell has to know its column. Cells with
 * a `colspan` (empty states, expanded previews) span the whole table and stay
 * out of it. Sticky cells need an opaque background, or the cells scrolling
 * under them show through: body cells paint the row's tint over the page
 * background, and the last pinned column draws a divider on its right edge.
 */
export function pinnedColumnsCss(scope: string, widths: readonly number[], count: number): string {
  const offsets = pinnedOffsets(widths, count);
  const table = `[data-pin-scope="${scope}"]`;
  return offsets
    .flatMap((left, column) => {
      const nth = `:nth-child(${column + 1}):not([colspan])`;
      const edge = column === offsets.length - 1;
      const divider = "inset -1px 0 0 var(--color-border)";
      return [
        `${table} tr > :is(th, td)${nth} { position: sticky; left: ${left}px; z-index: 2; }`,
        `${table} thead th${nth} { z-index: 3; background-color: var(--color-pinned);${
          edge ? ` box-shadow: inset 0 -1px 0 var(--color-border), ${divider};` : ""
        } }`,
        `${table} tbody td${nth} { background: linear-gradient(var(--row-tint, transparent), var(--row-tint, transparent)), var(--color-pinned);${
          edge ? ` box-shadow: ${divider};` : ""
        } }`,
      ];
    })
    .join("\n");
}

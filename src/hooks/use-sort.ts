import { useMemo, useState } from "react";

import { nextSort, sortRows, type SortState, type SortValue } from "@/lib/sort";

/** How to read each sortable column's value from a row. */
export type SortColumns<T, K extends string> = Record<K, (row: T) => SortValue>;

export interface Sorter<T, K extends string> {
  /** The rows in display order (the input order when unsorted). */
  rows: readonly T[];
  sort: SortState<K> | null;
  /** Header click: sort by `key`, flip its direction, or clear it. */
  toggle: (key: K) => void;
  /** Changes whenever the order does; pass it to `usePagination` to go back to page 1. */
  key: string;
}

/**
 * Client-side column sorting for a table. Sort before paginating, so the
 * order covers every row rather than just the visible page.
 *
 * `columns` should be a module constant or memoized, since a new object
 * re-sorts the rows.
 */
export function useSort<T, K extends string>(
  rows: readonly T[],
  columns: SortColumns<T, K>,
  initial: SortState<K> | null = null,
): Sorter<T, K> {
  const [sort, setSort] = useState(initial);
  const sorted = useMemo(
    () => (sort ? sortRows(rows, columns[sort.key], sort.direction) : rows),
    [rows, columns, sort],
  );
  return {
    rows: sorted,
    sort,
    toggle: (key) => setSort((current) => nextSort(current, key)),
    key: sort ? `${sort.key}:${sort.direction}` : "",
  };
}

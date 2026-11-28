import { useCallback, useMemo } from "react";

import {
  activeFilterCount,
  applyColumnFilters,
  type ColumnFilter,
  type ColumnFilters,
  type FilterColumns,
} from "@/lib/column-filter";

import { useViewState } from "./use-view-state";

export interface ColumnFiltering<T, K extends string> {
  rows: readonly T[];
  filters: ColumnFilters<K>;
  setFilter: (column: K, filter: ColumnFilter | null) => void;
  clear: () => void;
  /** How many columns narrow the rows. */
  active: number;
}

/**
 * Per-column filters for a table whose rows are all loaded, kept like its sorting (see `useViewState`).
 * `columns` must keep its identity between renders, or the rows are filtered again on every one.
 */
export function useColumnFilters<T, K extends string>(
  id: string,
  rows: readonly T[],
  columns: FilterColumns<T, K>,
): ColumnFiltering<T, K> {
  const [filters, setFilters] = useViewState<ColumnFilters<K>>(`${id}.columnFilters`, {});
  const filtered = useMemo(() => applyColumnFilters(rows, columns, filters), [rows, columns, filters]);
  const setFilter = useCallback(
    (column: K, filter: ColumnFilter | null) =>
      setFilters((current) => {
        const next = { ...current };
        if (filter) next[column] = filter;
        else delete next[column];
        return next;
      }),
    [setFilters],
  );
  const clear = useCallback(() => setFilters({}), [setFilters]);
  return { rows: filtered, filters, setFilter, clear, active: activeFilterCount(filters) };
}

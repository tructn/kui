/** A filter on one table column: the cell text contains `text`, or the cell is one of `values`. */
export type ColumnFilter = { kind: "text"; text: string } | { kind: "options"; values: readonly string[] };

export type ColumnFilters<K extends string> = Partial<Record<K, ColumnFilter>>;

/** How to read each filterable column of a row: the text a text filter searches, or the option value. */
export type FilterColumns<T, K extends string> = Record<K, (row: T) => string>;

/** Whether `filter` narrows anything; an empty text or no picked options shows every row. */
export function isFilterActive(filter: ColumnFilter | undefined): filter is ColumnFilter {
  if (!filter) return false;
  switch (filter.kind) {
    case "text":
      return filter.text.trim() !== "";
    case "options":
      return filter.values.length > 0;
  }
}

function matches(filter: ColumnFilter, cell: string): boolean {
  switch (filter.kind) {
    case "text":
      return cell.toLowerCase().includes(filter.text.trim().toLowerCase());
    case "options":
      return filter.values.includes(cell);
  }
}

/** The rows that pass every active filter, in their original order. */
export function applyColumnFilters<T, K extends string>(
  rows: readonly T[],
  columns: FilterColumns<T, K>,
  filters: ColumnFilters<K>,
): readonly T[] {
  const active = (Object.keys(columns) as K[]).flatMap((key) => {
    const filter = filters[key];
    return isFilterActive(filter) ? [{ read: columns[key], filter }] : [];
  });
  if (active.length === 0) return rows;
  return rows.filter((row) => active.every(({ read, filter }) => matches(filter, read(row))));
}

export function activeFilterCount<K extends string>(filters: ColumnFilters<K>): number {
  return Object.values<ColumnFilter | undefined>(filters).filter(isFilterActive).length;
}

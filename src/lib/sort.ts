export type SortDirection = "asc" | "desc";

export interface SortState<K extends string> {
  key: K;
  direction: SortDirection;
}

/** What a column sorts by. `null`/`undefined` (e.g. "—" cells) always sort last. */
export type SortValue = string | number | boolean | null | undefined;

// Natural order, so "topic-2" comes before "topic-10"; case-insensitive.
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function isMissing(value: SortValue): value is null | undefined {
  return value == null || (typeof value === "number" && Number.isNaN(value));
}

/** Ascending comparison of two present values: numbers numerically, everything else as text. */
export function compareValues(a: Exclude<SortValue, null | undefined>, b: Exclude<SortValue, null | undefined>): number {
  if (typeof a !== "string" && typeof b !== "string") return Number(a) - Number(b);
  return collator.compare(String(a), String(b));
}

/**
 * A sorted copy of `rows`. The sort is stable, so equal values keep their
 * original order, and missing values stay at the end in both directions.
 */
export function sortRows<T>(rows: readonly T[], value: (row: T) => SortValue, direction: SortDirection): T[] {
  const sign = direction === "asc" ? 1 : -1;
  return rows
    .map((row) => ({ row, value: value(row) }))
    .sort((a, b) => {
      const aMissing = isMissing(a.value);
      const bMissing = isMissing(b.value);
      if (aMissing || bMissing) return Number(aMissing) - Number(bMissing);
      return sign * compareValues(a.value!, b.value!);
    })
    .map(({ row }) => row);
}

/** Clicking a column header: a new column sorts ascending, then descending, then unsorted. */
export function nextSort<K extends string>(current: SortState<K> | null, key: K): SortState<K> | null {
  if (current?.key !== key) return { key, direction: "asc" };
  return current.direction === "asc" ? { key, direction: "desc" } : null;
}

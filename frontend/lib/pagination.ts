/** Rows-per-page choices offered under every table. */
export const PAGE_SIZES = [25, 50, 100, 250] as const;

export interface Page<T> {
  /** The rows to render. */
  items: T[];
  /** 0-based page actually shown (clamped into range). */
  page: number;
  pageCount: number;
  /** 1-based positions of the first and last row shown; both 0 when empty. */
  from: number;
  to: number;
  total: number;
}

/** Slices `items` to one page. Out-of-range pages snap to the nearest valid one. */
export function paginate<T>(items: readonly T[], page: number, pageSize: number): Page<T> {
  const size = Math.max(1, Math.floor(pageSize));
  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / size));
  const current = Math.min(Math.max(0, Math.floor(page)), pageCount - 1);
  const start = current * size;
  const slice = items.slice(start, start + size);
  return {
    items: slice,
    page: current,
    pageCount,
    from: total === 0 ? 0 : start + 1,
    to: start + slice.length,
    total,
  };
}

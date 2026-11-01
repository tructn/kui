/**
 * Items whose name contains `query`, ignoring case: names starting with it
 * first, then names containing it, each in list order. An empty query matches all.
 */
export function matchByName<T extends { name: string }>(items: readonly T[], query: string): readonly T[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  const starts: T[] = [];
  const contains: T[] = [];
  for (const item of items) {
    const name = item.name.toLowerCase();
    if (name.startsWith(q)) starts.push(item);
    else if (name.includes(q)) contains.push(item);
  }
  return [...starts, ...contains];
}

export type NameFilter = {
  /** Whether a name passes the filter; nothing passes while `error` is set. */
  matches: (name: string) => boolean;
  /** Why `query` isn't a valid regular expression, in regex mode. */
  error: string | null;
};

/**
 * A case-insensitive name filter: `query` as a substring, or with `regex` on,
 * as a regular expression tested anywhere in the name (anchor with ^ and $).
 */
export function nameFilter(query: string, regex: boolean): NameFilter {
  if (!query) return { matches: () => true, error: null };
  if (!regex) {
    const q = query.toLowerCase();
    return { matches: (name) => name.toLowerCase().includes(q), error: null };
  }
  try {
    const re = new RegExp(query, "i");
    return { matches: (name) => re.test(name), error: null };
  } catch (e) {
    return { matches: () => false, error: e instanceof Error ? e.message : String(e) };
  }
}

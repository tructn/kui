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

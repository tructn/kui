const MAX_DEPTH = 8;
/** Arrays are sampled, so a list of 10,000 items doesn't become 10,000 paths. */
const ARRAY_ITEMS = 3;

/** Dotted paths to every leaf of a JSON value (`customer.name`, `items.0.sku`), at most `limit`. */
export function leafPaths(value: unknown, limit = 60): string[] {
  const out: string[] = [];
  const walk = (node: unknown, prefix: string, depth: number) => {
    if (out.length >= limit) return;
    const children = childrenOf(node);
    if (children === null || depth >= MAX_DEPTH) {
      if (prefix) out.push(prefix);
      return;
    }
    for (const [name, child] of children) walk(child, prefix ? `${prefix}.${name}` : name, depth + 1);
  };
  if (childrenOf(value) !== null) walk(value, "", 0);
  return out;
}

/** The entries of a non-empty object or array; null for anything that is a leaf. */
function childrenOf(node: unknown): [string, unknown][] | null {
  if (Array.isArray(node)) return node.length === 0 ? null : node.slice(0, ARRAY_ITEMS).map((v, i) => [String(i), v]);
  if (node !== null && typeof node === "object") {
    const entries = Object.entries(node);
    return entries.length === 0 ? null : entries;
  }
  return null;
}

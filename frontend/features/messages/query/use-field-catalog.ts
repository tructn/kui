import { useCallback, useRef } from "react";

import type { KafkaMessage } from "../types";
import { buildCatalog, type FieldCatalog } from "./catalog";

/**
 * While the catalog is younger than this, a changed source list doesn't rebuild it.
 * A busy live tail changes on every batch; without this, each keystroke would rebuild
 * the whole catalog from up to ~1,500 messages and make typing stutter.
 */
const MIN_REBUILD_MS = 1000;

/**
 * A getter for the catalog of `sources` (lists of sampled messages). It is built
 * only when suggestions ask for it, and rebuilt only after a list changes (at most
 * once per MIN_REBUILD_MS), so a busy live tail costs nothing until the user opens
 * the suggestions.
 */
export function useFieldCatalog(sources: readonly (readonly KafkaMessage[])[]): () => FieldCatalog {
  const latest = useRef(sources);
  latest.current = sources;
  const cache = useRef<{ sources: readonly (readonly KafkaMessage[])[]; catalog: FieldCatalog; builtAt: number } | null>(null);

  return useCallback(() => {
    const current = latest.current;
    const cached = cache.current;
    const now = Date.now();
    if (cached) {
      const same = cached.sources.length === current.length && cached.sources.every((s, i) => s === current[i]);
      // Still rebuild right away when it was built from nothing (the sample hadn't arrived yet).
      if (same || (now - cached.builtAt < MIN_REBUILD_MS && cached.catalog.sampled > 0)) return cached.catalog;
    }
    const catalog = buildCatalog(current.flat());
    cache.current = { sources: current, catalog, builtAt: now };
    return catalog;
  }, []);
}

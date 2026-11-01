import { useCallback, useRef } from "react";

import type { KafkaMessage } from "../types";
import { buildCatalog, type FieldCatalog } from "./catalog";

/**
 * A getter for the catalog of `sources` (lists of sampled messages). It is built
 * only when suggestions ask for it, and rebuilt only after a list changes, so a
 * busy live tail costs nothing until the user opens the suggestions.
 */
export function useFieldCatalog(sources: readonly (readonly KafkaMessage[])[]): () => FieldCatalog {
  const latest = useRef(sources);
  latest.current = sources;
  const cache = useRef<{ sources: readonly (readonly KafkaMessage[])[]; catalog: FieldCatalog } | null>(null);

  return useCallback(() => {
    const current = latest.current;
    const cached = cache.current;
    if (cached && cached.sources.length === current.length && cached.sources.every((s, i) => s === current[i])) {
      return cached.catalog;
    }
    const catalog = buildCatalog(current.flat());
    cache.current = { sources: current, catalog };
    return catalog;
  }, []);
}

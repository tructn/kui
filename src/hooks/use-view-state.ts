import { useCallback, useEffect, useState } from "react";

import { useViewStateStore } from "@/app/stores/view-state-store";

import { useDebouncedValue } from "./use-debounced-value";

type Update<T> = T | ((current: T) => T);

/**
 * `useState` for a view's sorting or filters, shared by `id`.
 *
 * With Settings → General → "Remember sorting and filters" on (the default),
 * the value is saved and comes back on every visit and after a restart. Off,
 * it lives only while the view is open, so each visit starts from `initial`.
 */
export function useViewState<T>(id: string, initial: T): [T, (update: Update<T>) => void] {
  const value = useViewValue(id, initial);
  const remember = useViewStateStore((s) => s.remember);

  const setValue = useCallback(
    (update: Update<T>) => {
      const store = useViewStateStore.getState();
      const current = ((store.remember ? store.saved : store.session)[id] as T | undefined) ?? initial;
      store.set(id, typeof update === "function" ? (update as (current: T) => T)(current) : update);
    },
    // `initial` is only a fallback; a new literal each render must not make a new setter.
    [id],
  );

  // Not remembering: leaving the view drops its value, so the next visit starts fresh.
  useEffect(() => {
    if (!remember) return () => useViewStateStore.getState().forget(id);
  }, [id, remember]);

  return [value, setValue];
}

/**
 * `useViewState` for a list's filter box. `input` follows every keystroke;
 * `search`, which the list filters by, and the saved value follow once typing
 * pauses. Re-filtering, re-sorting and rewriting settings.json on every key
 * press made typing in a long list stall.
 */
export function useViewSearch(id: string, delayMs = 200): [input: string, search: string, setInput: (value: string) => void] {
  const [saved, setSaved] = useViewState(id, "");
  const [input, setInput] = useState(saved);
  const search = useDebouncedValue(input, delayMs);

  useEffect(() => {
    if (search !== saved) setSaved(search);
  }, [search, saved, setSaved]);

  return [input, search, setInput];
}

/** Reads a view value without owning it, e.g. ⌘K search following the topic list's "Show internal". */
export function useViewValue<T>(id: string, initial: T): T {
  return useViewStateStore((s) => ((s.remember ? s.saved : s.session)[id] as T | undefined) ?? initial);
}

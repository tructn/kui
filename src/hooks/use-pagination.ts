import { useMemo, useState } from "react";

import { useTablePrefs } from "@/app/stores/table-store";
import { paginate, type Page } from "@/lib/pagination";

export interface Pager<T> extends Page<T> {
  pageSize: number;
  /**
   * Set for server-side paging, where pages can only be stepped through:
   * whether a next page exists. The "last page" button is then hidden.
   */
  hasNext?: boolean;
  setPage: (page: number) => void;
  setPageSize: (pageSize: number) => void;
}

/**
 * Client-side paging for a table. `resetKey` (e.g. the search text) sends the
 * table back to page 1 when it changes; shrinking data clamps to the last page.
 * `kind: "messages"` uses the separate rows-per-page setting for messages.
 */
export function usePagination<T>(items: readonly T[], resetKey?: unknown, kind: "rows" | "messages" = "rows"): Pager<T> {
  const messages = kind === "messages";
  const pageSize = useTablePrefs((s) => (messages ? s.messagePageSize : s.pageSize));
  const setPageSize = useTablePrefs((s) => (messages ? s.setMessagePageSize : s.setPageSize));
  const [state, setState] = useState({ page: 0, resetKey });

  // Reset during render rather than in an effect, so the stale page never paints.
  let page = state.page;
  if (!Object.is(state.resetKey, resetKey)) {
    page = 0;
    setState({ page: 0, resetKey });
  }

  const result = useMemo(() => paginate(items, page, pageSize), [items, page, pageSize]);
  return {
    ...result,
    pageSize,
    setPage: (next) => setState((s) => ({ ...s, page: next })),
    setPageSize: (size) => {
      setPageSize(size);
      setState((s) => ({ ...s, page: 0 }));
    },
  };
}

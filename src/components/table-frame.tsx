import { ChevronLeftIcon, ChevronRightIcon, ChevronsLeftIcon, ChevronsRightIcon } from "lucide-react";
import type { ReactElement, ReactNode } from "react";

import { ShortcutHint } from "@/components/shortcut-hint";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Pager } from "@/hooks/use-pagination";
import { useShortcut } from "@/hooks/use-shortcut";
import { formatNumber } from "@/lib/format";
import { PAGE_SIZES } from "@/lib/pagination";
import { cn } from "@/lib/utils";

interface TableFrameProps {
  children: ReactNode;
  /** Adds the page controls under the table. */
  pager?: Pager<unknown>;
  /**
   * Stretch to the parent's full height (the parent must be a flex column). Default true.
   * Embedded tables (`false`) show the pager only once there is more than one page of rows.
   */
  fill?: boolean;
  className?: string;
}

/**
 * The bordered box every data table sits in: rows scroll under a sticky header,
 * and the pager stays pinned to the bottom edge.
 */
export function TableFrame({ children, pager, fill = true, className }: TableFrameProps) {
  return (
    <div className={cn("flex flex-col rounded-lg border", fill && "min-h-0 flex-1", className)}>
      {/* min-h-0 lets the scroll area shrink below its content, so a max height works.
          This box is the scroll container in both directions; the table's own
          overflow wrapper is switched off, or the sticky header would stick to
          that wrapper (which never scrolls vertically) instead. It is also the
          size container, so `100cqw` inside the table means "the visible width". */}
      <div
        className={cn(
          "@container/table-frame min-h-0 overflow-auto [&_[data-slot=table-container]]:overflow-visible",
          fill && "flex-1"
        )}
      >
        {children}
      </div>
      {pager && (fill || pager.total > PAGE_SIZES[0]) && <TablePagination pager={pager} shortcuts={fill} />}
    </div>
  );
}

/** `shortcuts`: [ and ] page through this table (only the page's main table gets them). */
function TablePagination({ pager, shortcuts }: { pager: Pager<unknown>; shortcuts: boolean }) {
  const { page, pageCount, from, to, total, pageSize, hasNext, setPage, setPageSize } = pager;
  const first = page === 0;
  const last = hasNext === undefined ? page >= pageCount - 1 : !hasNext;
  useShortcut("[", () => !first && setPage(page - 1), shortcuts);
  useShortcut("]", () => !last && setPage(page + 1), shortcuts);

  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t px-3 py-1.5 text-xs text-muted-foreground">
      <span className="tabular-nums" aria-live="polite">
        {total === 0 ? "No rows" : `${formatNumber(from)}–${formatNumber(to)} of ${formatNumber(total)}`}
      </span>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <span>Rows per page</span>
          <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
            <SelectTrigger size="sm" className="h-7 w-20" aria-label="Rows per page">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZES.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <span className="tabular-nums">
          Page {page + 1} of {pageCount}
        </span>
        <div className="flex items-center gap-0.5">
          <Button variant="ghost" size="icon-xs" aria-label="First page" disabled={first} onClick={() => setPage(0)}>
            <ChevronsLeftIcon />
          </Button>
          <ShortcutTooltip label="Previous page" shortcut={shortcuts ? "[" : undefined}>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Previous page"
              aria-keyshortcuts={shortcuts ? "[" : undefined}
              disabled={first}
              onClick={() => setPage(page - 1)}
            >
              <ChevronLeftIcon />
            </Button>
          </ShortcutTooltip>
          <ShortcutTooltip label="Next page" shortcut={shortcuts ? "]" : undefined}>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Next page"
              aria-keyshortcuts={shortcuts ? "]" : undefined}
              disabled={last}
              onClick={() => setPage(page + 1)}
            >
              <ChevronRightIcon />
            </Button>
          </ShortcutTooltip>
          {hasNext === undefined && (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Last page"
              disabled={last}
              onClick={() => setPage(pageCount - 1)}
            >
              <ChevronsRightIcon />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Hover/focus tooltip naming the button and its key, when it has one. */
function ShortcutTooltip({ label, shortcut, children }: { label: string; shortcut?: string; children: ReactElement }) {
  if (!shortcut) return children;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent className="flex items-center gap-2">
        {label}
        <ShortcutHint keys={[shortcut]} />
      </TooltipContent>
    </Tooltip>
  );
}

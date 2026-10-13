import { ArrowDownIcon, ArrowUpIcon, ChevronsUpDownIcon } from "lucide-react";
import type { ComponentProps } from "react";

import { TableHead } from "@/components/ui/table";
import type { SortState } from "@/lib/sort";
import { cn } from "@/lib/utils";

interface SortableTableHeadProps<K extends string> extends ComponentProps<typeof TableHead> {
  column: K;
  sort: SortState<K> | null;
  onSort: (column: K) => void;
  /** Right-aligned (numeric) columns put the arrow first, so the labels stay flush right. */
  align?: "left" | "right";
}

/** A column header that sorts the table when clicked (see `useSort`). */
export function SortableTableHead<K extends string>({
  column,
  sort,
  onSort,
  align = "left",
  className,
  children,
  ...props
}: SortableTableHeadProps<K>) {
  const direction = sort?.key === column ? sort.direction : null;
  const Icon = direction === "asc" ? ArrowUpIcon : direction === "desc" ? ArrowDownIcon : ChevronsUpDownIcon;
  return (
    <TableHead
      aria-sort={direction === "asc" ? "ascending" : direction === "desc" ? "descending" : undefined}
      className={cn(align === "right" && "text-right", className)}
      {...props}
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        className={cn(
          "group/sort -mx-1 inline-flex items-center gap-1 rounded-sm px-1 py-0.5 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
          align === "right" && "flex-row-reverse",
        )}
      >
        {children}
        <Icon
          aria-hidden
          className={cn(
            "size-3.5 shrink-0",
            direction
              ? "text-foreground"
              : "text-muted-foreground opacity-40 group-hover/sort:opacity-100 group-focus-visible/sort:opacity-100",
          )}
        />
      </button>
    </TableHead>
  );
}

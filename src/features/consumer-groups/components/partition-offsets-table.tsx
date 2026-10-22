import { SortableTableHead } from "@/components/sortable-table-head";
import { TableFrame } from "@/components/table-frame";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useColumnResize } from "@/hooks/use-column-resize";
import { usePagination } from "@/hooks/use-pagination";
import { useSort, type SortColumns } from "@/hooks/use-sort";
import { formatNumber } from "@/lib/format";

import type { PartitionOffset } from "../types";
import { isUnread, PartitionStatusBadge } from "./partition-status-badge";
import { partitionSegments, ProgressBar } from "./progress-bar";

const COLUMNS: SortColumns<
  PartitionOffset,
  "partition" | "owner" | "consumed" | "remaining"
> = {
  partition: (o) => o.partition,
  owner: (o) => o.owner,
  consumed: (o) => partitionSegments(o).consumed,
  remaining: (o) => o.lag,
};

/** Where a group stands on each partition of one topic: consumed and remaining messages. */
export function PartitionOffsetsTable({
  offsets,
}: {
  offsets: PartitionOffset[];
}) {
  const sorter = useSort("partition-offsets", offsets, COLUMNS);
  const pager = usePagination(sorter.rows, sorter.key);
  const resize = useColumnResize("partition-offsets", 5);
  return (
    // Sits inside a bordered section, so no border of its own.
    <TableFrame pager={pager} fill={false} className="rounded-none border-0">
      <Table resize={resize}>
        <TableHeader>
          <TableRow>
            <SortableTableHead
              column="partition"
              sort={sorter.sort}
              onSort={sorter.toggle}
              align="right"
              className="w-16"
            >
              Partition
            </SortableTableHead>
            <SortableTableHead
              column="owner"
              sort={sorter.sort}
              onSort={sorter.toggle}
            >
              Consumer
            </SortableTableHead>
            <TableHead className="w-28">Progress</TableHead>
            <SortableTableHead
              column="consumed"
              sort={sorter.sort}
              onSort={sorter.toggle}
              align="right"
            >
              Consumed
            </SortableTableHead>
            <SortableTableHead
              column="remaining"
              sort={sorter.sort}
              onSort={sorter.toggle}
              align="right"
            >
              Remaining
            </SortableTableHead>
          </TableRow>
        </TableHeader>
        <TableBody className="font-mono text-xs tabular-nums">
          {pager.items.map((o) => {
            const segments = partitionSegments(o);
            return (
              <TableRow key={`${o.topic}/${o.partition}`}>
                <TableCell className="text-right">{o.partition}</TableCell>
                <TableCell
                  className="max-w-40 truncate"
                  title={o.owner ?? undefined}
                >
                  {o.owner ?? (
                    <span className="font-sans text-muted-foreground">
                      unassigned
                    </span>
                  )}
                </TableCell>
                <TableCell className="font-sans">
                  {isUnread(o) ? (
                    <PartitionStatusBadge status={o.status} />
                  ) : (
                    <ProgressBar segments={segments} />
                  )}
                </TableCell>
                <TableCell
                  className="text-right"
                  title={
                    o.committed == null
                      ? undefined
                      : `Committed offset ${formatNumber(o.committed)}`
                  }
                >
                  {segments.consumed == null
                    ? "—"
                    : formatNumber(segments.consumed)}
                </TableCell>
                <TableCell
                  className={
                    o.lag
                      ? "text-right text-amber-600 dark:text-amber-400"
                      : "text-right"
                  }
                >
                  {o.lag == null ? "—" : formatNumber(o.lag)}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableFrame>
  );
}

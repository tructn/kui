import { SortableTableHead } from "@/components/sortable-table-head";
import { Badge } from "@/components/ui/badge";
import { TableFrame } from "@/components/table-frame";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { useColumnResize } from "@/hooks/use-column-resize";
import { usePagination } from "@/hooks/use-pagination";
import { useSort, type SortColumns } from "@/hooks/use-sort";
import { formatNumber } from "@/lib/format";

import type { Partition } from "../types";

const COLUMNS: SortColumns<Partition, "id" | "leader" | "replicas" | "isr" | "low" | "high" | "messages"> = {
  id: (p) => p.id,
  leader: (p) => (p.leader < 0 ? null : p.leader), // offline sorts last
  replicas: (p) => p.replicas.join(","),
  isr: (p) => p.isr.join(","),
  low: (p) => p.low,
  high: (p) => p.high,
  messages: (p) => p.high - p.low,
};

/** `emptyText` replaces "No partitions." while the topic is loading or failed. */
export function PartitionsTable({ partitions, emptyText }: { partitions: Partition[]; emptyText?: string }) {
  const sorter = useSort("topic-partitions", partitions, COLUMNS);
  const pager = usePagination(sorter.rows, sorter.key);
  const resize = useColumnResize("partitions", 7);
  return (
    <TableFrame pager={pager}>
      <Table resize={resize}>
        <TableHeader>
          <TableRow>
            <SortableTableHead column="id" sort={sorter.sort} onSort={sorter.toggle} className="w-24">Partition</SortableTableHead>
            <SortableTableHead column="leader" sort={sorter.sort} onSort={sorter.toggle} className="w-24">Leader</SortableTableHead>
            <SortableTableHead column="replicas" sort={sorter.sort} onSort={sorter.toggle}>Replicas</SortableTableHead>
            <SortableTableHead column="isr" sort={sorter.sort} onSort={sorter.toggle}>In-sync</SortableTableHead>
            <SortableTableHead column="low" sort={sorter.sort} onSort={sorter.toggle} align="right">Start offset</SortableTableHead>
            <SortableTableHead column="high" sort={sorter.sort} onSort={sorter.toggle} align="right">End offset</SortableTableHead>
            <SortableTableHead column="messages" sort={sorter.sort} onSort={sorter.toggle} align="right">Messages</SortableTableHead>
          </TableRow>
        </TableHeader>
        <TableBody className="font-mono text-xs tabular-nums">
          {pager.items.map((p) => {
            const underReplicated = p.isr.length < p.replicas.length;
            return (
              <TableRow key={p.id}>
                <TableCell>{p.id}</TableCell>
                <TableCell>{p.leader < 0 ? <Badge variant="destructive">offline</Badge> : p.leader}</TableCell>
                <TableCell>{p.replicas.join(", ")}</TableCell>
                <TableCell className={underReplicated ? "text-destructive" : undefined}>{p.isr.join(", ")}</TableCell>
                <TableCell className="text-right">{formatNumber(p.low)}</TableCell>
                <TableCell className="text-right">{formatNumber(p.high)}</TableCell>
                <TableCell className="text-right">{formatNumber(p.high - p.low)}</TableCell>
              </TableRow>
            );
          })}
          {partitions.length === 0 && (
            <TableRow>
              <TableCell colSpan={7} className="h-24 text-center font-sans text-muted-foreground">
                {emptyText ?? "No partitions."}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </TableFrame>
  );
}

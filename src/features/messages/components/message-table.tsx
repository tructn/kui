import { SortableTableHead } from "@/components/sortable-table-head";
import { TableFrame } from "@/components/table-frame";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { useColumnResize } from "@/hooks/use-column-resize";
import { usePagination, type Pager } from "@/hooks/use-pagination";
import { useRowNavigation } from "@/hooks/use-row-navigation";
import { useSort, type SortColumns } from "@/hooks/use-sort";
import { formatTimestamp } from "@/lib/format";
import { cn } from "@/lib/utils";

import type { KafkaMessage } from "../types";

interface MessageTableProps {
  messages: KafkaMessage[];
  onSelect: (message: KafkaMessage) => void;
  emptyText: string;
  /** Fade rows in as they arrive (live mode). */
  animate?: boolean;
  /** Server-side paging; without it the table pages `messages` itself. */
  pager?: Pager<KafkaMessage>;
}

type Column = "partition" | "offset" | "timestamp" | "key" | "value";

const COLUMNS: SortColumns<KafkaMessage, Column> = {
  partition: (m) => m.partition,
  offset: (m) => m.offset,
  timestamp: (m) => m.timestamp,
  key: (m) => m.key?.text,
  value: (m) => m.value?.text,
};

export function MessageTable({ messages, onSelect, emptyText, animate, pager: serverPager }: MessageTableProps) {
  // With server-side paging only the loaded page is here, so sorting reorders
  // that page; otherwise it sorts every message before paging.
  const sorter = useSort(serverPager ? serverPager.items : messages, COLUMNS);
  const localPager = usePagination(sorter.rows, sorter.key);
  const pager = serverPager ?? localPager;
  const items = serverPager ? sorter.rows : localPager.items;
  const rowProps = useRowNavigation(items.length);
  const resize = useColumnResize("messages", 5);
  const head = (column: Column, label: string, className: string, align?: "right") => (
    <SortableTableHead
      column={column}
      sort={sorter.sort}
      onSort={sorter.toggle}
      align={align}
      className={className}
      title={serverPager ? "Sorts the messages on this page" : undefined}
    >
      {label}
    </SortableTableHead>
  );
  return (
    <TableFrame pager={pager}>
      <Table resize={resize} className="table-fixed" aria-label="Messages. Use the arrow keys to move between rows and Enter to open one.">
        <TableHeader>
          <TableRow>
            {head("partition", "Partition", "w-24", "right")}
            {head("offset", "Offset", "w-24", "right")}
            {head("timestamp", "Timestamp", "w-52")}
            {head("key", "Key", "w-48")}
            {head("value", "Value", "")}
          </TableRow>
        </TableHeader>
        <TableBody className="font-mono text-xs">
          {items.map((m, i) => {
            const row = rowProps(i, () => onSelect(m));
            return (
            <TableRow
              key={`${m.partition}/${m.offset}`}
              {...row}
              className={cn(row.className, animate && "animate-in duration-500 fade-in")}
            >
              <TableCell className="text-right tabular-nums">{m.partition}</TableCell>
              <TableCell className="text-right tabular-nums">{m.offset}</TableCell>
              <TableCell className="text-muted-foreground tabular-nums">{formatTimestamp(m.timestamp)}</TableCell>
              <TableCell className="truncate">{m.key?.text ?? <Null />}</TableCell>
              <TableCell className="truncate">{m.value?.text ?? <Null />}</TableCell>
            </TableRow>
            );
          })}
          {messages.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="h-24 text-center font-sans text-muted-foreground">
                {emptyText}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </TableFrame>
  );
}

function Null() {
  return <span className="text-muted-foreground italic">null</span>;
}

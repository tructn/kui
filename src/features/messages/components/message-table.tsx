import type { ReactNode } from "react";

import { SortableTableHead } from "@/components/sortable-table-head";
import { TableFrame } from "@/components/table-frame";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useColumnResize } from "@/hooks/use-column-resize";
import { usePagination, type Pager } from "@/hooks/use-pagination";
import { useRowNavigation } from "@/hooks/use-row-navigation";
import { useSort, type SortColumns } from "@/hooks/use-sort";
import { formatTimestamp } from "@/lib/format";
import { cn } from "@/lib/utils";

import type { KafkaMessage, MessageRef } from "../types";

interface MessageTableProps {
  messages: KafkaMessage[];
  onSelect: (message: KafkaMessage) => void;
  emptyText: ReactNode;
  /** Fade rows in as they arrive (live mode). */
  animate?: boolean;
  /** Server-side paging; without it the table pages `messages` itself. */
  pager?: Pager<KafkaMessage>;
  /** Checked messages by `messageKey`; with `onCheckedChange`, rows get checkboxes. */
  checked?: ReadonlyMap<string, MessageRef>;
  onCheckedChange?: (checked: ReadonlyMap<string, MessageRef>) => void;
}

export const messageKey = (m: MessageRef) => `${m.partition}/${m.offset}`;

type Column = "partition" | "offset" | "timestamp" | "key" | "value";

const COLUMNS: SortColumns<KafkaMessage, Column> = {
  partition: (m) => m.partition,
  offset: (m) => m.offset,
  timestamp: (m) => m.timestamp,
  key: (m) => m.key?.text,
  value: (m) => m.value?.text,
};

export function MessageTable({
  messages,
  onSelect,
  emptyText,
  animate,
  pager: serverPager,
  checked,
  onCheckedChange,
}: MessageTableProps) {
  // With server-side paging only the loaded page is here, so sorting reorders
  // that page; otherwise it sorts every message before paging.
  const sorter = useSort("messages", serverPager ? serverPager.items : messages, COLUMNS);
  const localPager = usePagination(sorter.rows, sorter.key);
  const pager = serverPager ?? localPager;
  const items = serverPager ? sorter.rows : localPager.items;
  const rowProps = useRowNavigation(items.length);
  const selectable = checked != null && onCheckedChange != null;
  // Separate saved widths: the checkbox column shifts every other one.
  const resize = useColumnResize(selectable ? "messages-select" : "messages", selectable ? 6 : 5);
  const pageChecked = selectable ? items.filter((m) => checked.has(messageKey(m))).length : 0;
  const allChecked = items.length > 0 && pageChecked === items.length;

  function toggle(on: boolean, page: readonly KafkaMessage[]) {
    const next = new Map(checked);
    for (const m of page) {
      if (on) next.set(messageKey(m), { partition: m.partition, offset: m.offset });
      else next.delete(messageKey(m));
    }
    onCheckedChange?.(next);
  }

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
            {selectable && (
              <TableHead className="w-10">
                <Checkbox
                  aria-label="Select all messages on this page"
                  disabled={items.length === 0}
                  checked={allChecked ? true : pageChecked > 0 ? "indeterminate" : false}
                  onCheckedChange={() => toggle(!allChecked, items)}
                />
              </TableHead>
            )}
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
            const isChecked = checked?.has(messageKey(m)) ?? false;
            return (
            <TableRow
              key={messageKey(m)}
              {...row}
              data-state={isChecked ? "selected" : undefined}
              className={cn(row.className, animate && "animate-in duration-500 fade-in")}
            >
              {selectable && (
                // Keep checkbox clicks from opening the message.
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <Checkbox
                    aria-label={`Select partition ${m.partition}, offset ${m.offset}`}
                    checked={isChecked}
                    onCheckedChange={(on) => toggle(on === true, [m])}
                  />
                </TableCell>
              )}
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
              <TableCell colSpan={selectable ? 6 : 5} className="h-24 text-center font-sans text-muted-foreground">
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

import { ChevronRightIcon, ChevronsDownUpIcon, ChevronsUpDownIcon } from "lucide-react";
import { Fragment, useState, type KeyboardEvent, type ReactNode } from "react";

import { CopyButton } from "@/components/copy-button";
import { SortableTableHead } from "@/components/sortable-table-head";
import { TableFrame } from "@/components/table-frame";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableStateRow } from "@/components/ui/table";
import { useColumnResize } from "@/hooks/use-column-resize";
import { usePagination, type Pager } from "@/hooks/use-pagination";
import { useRowNavigation } from "@/hooks/use-row-navigation";
import { useSort, type SortColumns } from "@/hooks/use-sort";
import { formatBytes, formatTimestamp } from "@/lib/format";
import { cn } from "@/lib/utils";

import type { KafkaMessage, MessageRef, Payload } from "../types";
import { encodingLabel, PayloadViewTabs, usePayloadView } from "./payload-view-tabs";

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
  // The expand column, the checkbox column (when selectable) and the five data columns.
  const columnCount = selectable ? 7 : 6;
  // Separate saved widths per layout: the extra columns shift every other one.
  const resize = useColumnResize(selectable ? "messages-expand-select" : "messages-expand", columnCount);
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

  // Expanded rows by `messageKey`, so they stay open across sorting and paging back.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const anyExpanded = items.some((m) => expanded.has(messageKey(m)));

  function setRowExpanded(key: string, open: boolean) {
    setExpanded((current) => {
      if (current.has(key) === open) return current;
      const next = new Set(current);
      if (open) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  /** Collapses every row on this page if any is open, otherwise expands them all. */
  function toggleAllExpanded() {
    setExpanded((current) => {
      const next = new Set(current);
      for (const m of items) {
        if (anyExpanded) next.delete(messageKey(m));
        else next.add(messageKey(m));
      }
      return next;
    });
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
      <Table
        resize={resize}
        className="table-fixed"
        aria-label="Messages. Use the arrow keys to move between rows, Enter to open one, and Right or Left to expand or collapse it."
      >
        <TableHeader>
          <TableRow>
            <TableHead className="w-10 px-1 text-center">
              <Button
                variant="ghost"
                size="icon-xs"
                disabled={items.length === 0}
                aria-label={anyExpanded ? "Collapse all rows" : "Expand all rows"}
                title={anyExpanded ? "Collapse all rows" : "Expand all rows"}
                onClick={toggleAllExpanded}
              >
                {anyExpanded ? <ChevronsDownUpIcon /> : <ChevronsUpDownIcon />}
              </Button>
            </TableHead>
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
            const key = messageKey(m);
            const row = rowProps(i, () => onSelect(m));
            const isChecked = checked?.has(key) ?? false;
            const open = expanded.has(key);
            // Preview rows sit between messages, so `even:` striping would drift; stripe by index instead.
            // (Both classes carry `even:` so they replace the row's own `even:` stripe.)
            const stripe = i % 2 === 1 ? "bg-muted/40 even:bg-muted/40" : "even:bg-transparent";
            return (
            <Fragment key={key}>
            <TableRow
              {...row}
              onKeyDown={(event: KeyboardEvent<HTMLTableRowElement>) => {
                if (event.target === event.currentTarget && (event.key === "ArrowRight" || event.key === "ArrowLeft")) {
                  event.preventDefault();
                  setRowExpanded(key, event.key === "ArrowRight");
                } else row.onKeyDown(event);
              }}
              data-state={isChecked ? "selected" : undefined}
              className={cn(row.className, stripe, open && "border-b-0", animate && "animate-in duration-500 fade-in")}
            >
              <TableCell className="px-1 text-center">
                <Button
                  variant="ghost"
                  size="icon-xs"
                  // Rows are reached with the arrow keys; Right / Left do the same as this button.
                  tabIndex={-1}
                  aria-expanded={open}
                  aria-label={open ? "Collapse message" : "Expand message"}
                  onClick={(event) => {
                    event.stopPropagation(); // don't also open the side panel
                    setRowExpanded(key, !open);
                  }}
                >
                  <ChevronRightIcon className={cn("transition-transform", open && "rotate-90")} />
                </Button>
              </TableCell>
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
            {open && <MessagePreview message={m} colSpan={columnCount} />}
            </Fragment>
            );
          })}
          {messages.length === 0 && (
            <TableStateRow colSpan={columnCount} className="font-sans">
              {emptyText}
            </TableStateRow>
          )}
        </TableBody>
      </Table>
    </TableFrame>
  );
}

/**
 * The row under an expanded message: key, headers and value, for a quick look
 * without opening the side panel. The key is shown as plain text; the value
 * switches between JSON and Base64 and copies like it does there. Pinned to the visible width of the table frame,
 * like `TableStateRow`, so it doesn't scroll away sideways.
 */
function MessagePreview({ message, colSpan }: { message: KafkaMessage; colSpan: number }) {
  return (
    <tr data-slot="table-row" className="border-b bg-muted/40">
      <td colSpan={colSpan} className="p-0">
        <dl className="sticky left-0 grid w-[100cqw] grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-2 pt-1 pr-3 pb-3 pl-10">
          <dt className="text-muted-foreground">Key</dt>
          <dd className="break-all whitespace-pre-wrap">{message.key?.text ?? <Null />}</dd>
          <dt className="text-muted-foreground">Headers</dt>
          <dd className="flex flex-wrap gap-x-3 gap-y-0.5">
            {message.headers.length === 0 && <span className="text-muted-foreground italic">none</span>}
            {message.headers.map((h, i) => (
              <span key={i} className="break-all">
                <span className="text-muted-foreground">{h.key}=</span>
                {h.value ?? <Null />}
              </span>
            ))}
          </dd>
          <PreviewValue payload={message.value} />
        </dl>
      </td>
    </tr>
  );
}

/** The value in the preview: its JSON / Base64 switch, encoding, size and a copy button, then the text. */
function PreviewValue({ payload }: { payload: Payload | null }) {
  const { views, shown, setView, text } = usePayloadView(payload);
  return (
    <>
      <dt className="pt-1 text-muted-foreground">Value</dt>
      <dd className="flex min-w-0 flex-col gap-1">
        {payload == null || text == null ? (
          <span className="pt-1">
            <Null />
          </span>
        ) : (
          <>
            <div className="flex items-center gap-2 font-sans text-muted-foreground">
              <PayloadViewTabs views={views} value={shown} onChange={setView} compact label="Show value as" />
              <span>
                {encodingLabel(payload)} · {formatBytes(payload.size)}
              </span>
              <CopyButton value={text} label="Copy value" />
            </div>
            <pre className="max-h-72 overflow-auto rounded-md border bg-background p-3 leading-relaxed break-all whitespace-pre-wrap">
              {text}
            </pre>
          </>
        )}
      </dd>
    </>
  );
}

function Null() {
  return <span className="text-muted-foreground italic">null</span>;
}

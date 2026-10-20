import { XIcon } from "lucide-react";
import { useState } from "react";

import { ErrorState, LoadingRows } from "@/components/query-states";
import { ShortcutHint } from "@/components/shortcut-hint";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { useTablePrefs } from "@/app/stores/table-store";
import type { Pager } from "@/hooks/use-pagination";
import { useShortcut } from "@/hooks/use-shortcut";
import { formatNumber } from "@/lib/format";

import { LIVE_LIMIT, useLiveTail } from "../live-tail";
import { useBrowseMessages } from "../queries";
import type { BrowseCursor, BrowseFilters, BrowsePage, CopyTarget, KafkaMessage, MessageRef } from "../types";
import { CopyMessageDialog } from "./copy-message-dialog";
import { MessageFilters } from "./message-filters";
import { MessageSheet } from "./message-sheet";
import { MessageTable } from "./message-table";

interface MessageBrowserProps {
  clusterId: string;
  topic: string;
  partitions: number[];
  /** Topics a message can be copied to. */
  copyTargets: CopyTarget[];
  /** Hides copy: the topic is internal and must not be written to. */
  readOnly?: boolean;
}

/** Filter toolbar + message table + detail sheet for one topic, with an optional live tail. */
export function MessageBrowser({ clusterId, topic, partitions, copyTargets, readOnly = false }: MessageBrowserProps) {
  const [filters, setFilters] = useState<BrowseFilters>({ topic, partition: null, from: "latest", value: null });
  const pageSize = useTablePrefs((s) => s.pageSize);
  const setPageSize = useTablePrefs((s) => s.setPageSize);
  // cursors[i] reads page i, so stepping back reuses the cursor that led to a page.
  const [cursors, setCursors] = useState<(BrowseCursor | null)[]>([null]);
  const page = cursors.length - 1;
  const [live, setLive] = useState(false);
  const [selected, setSelected] = useState<KafkaMessage | null>(null);
  // Checked rows for copying. Kept across pages and filters, like the topics list.
  const [checked, setChecked] = useState<ReadonlyMap<string, MessageRef>>(new Map());
  const messages = useBrowseMessages(clusterId, { ...filters, pageSize, cursor: cursors[page] });
  const tail = useLiveTail(clusterId, topic, filters.partition, live);

  function toggleLive(on: boolean) {
    setLive(on);
    // Coming back from live mode: re-read so the table includes what just arrived.
    if (!on) messages.refetch();
  }
  useShortcut("l", () => toggleLive(!live));

  // While the next page loads, the old one is shown as a placeholder: its `next` is stale.
  const next = messages.isPlaceholderData ? null : (messages.data?.next ?? null);
  const pager = messages.data && serverPager(messages.data, page, pageSize, next !== null, {
    setPage: (to) => {
      if (to === page + 1 && next) setCursors([...cursors, next]);
      else if (to < page) setCursors(cursors.slice(0, to + 1));
    },
    setPageSize: (size) => {
      setPageSize(size);
      setCursors([null]);
    },
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex items-center gap-3">
        <MessageFilters
          partitions={partitions}
          filters={filters}
          disabled={live}
          // New filters start again from the first page.
          onChange={(patch) => {
            setFilters((f) => ({ ...f, ...patch }));
            setCursors([null]);
          }}
        />
        <div className="ml-auto flex items-center gap-3">
          {live ? (
            <span data-testid="live-count" className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-75" />
                <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
              </span>
              {formatNumber(tail.received)} new
              {tail.received > LIVE_LIMIT && ` · showing last ${formatNumber(LIVE_LIMIT)}`}
            </span>
          ) : (
            messages.isFetching && <Spinner className="size-3.5 text-muted-foreground" />
          )}
          <div className="flex items-center gap-2">
            <Switch id="live-tail" checked={live} onCheckedChange={toggleLive} aria-keyshortcuts="L" />
            <Label htmlFor="live-tail">Live</Label>
            <ShortcutHint keys={["L"]} />
          </div>
        </div>
      </div>

      {checked.size > 0 && !live && (
        <div className="flex items-center gap-2 rounded-lg border bg-muted/50 px-3 py-1.5 text-sm">
          <span>
            <span className="font-medium tabular-nums">{checked.size}</span> selected
          </span>
          <Button variant="ghost" size="xs" onClick={() => setChecked(new Map())}>
            <XIcon /> Clear
          </Button>
          <div className="flex-1" />
          <CopyMessageDialog
            clusterId={clusterId}
            topic={topic}
            messages={[...checked.values()]}
            targets={copyTargets}
            onCopied={() => setChecked(new Map())}
          />
        </div>
      )}

      {live ? (
        <>
          {tail.error && <ErrorState error={tail.error} onRetry={() => toggleLive(false)} />}
          <MessageTable
            messages={tail.messages}
            onSelect={setSelected}
            animate
            emptyText={
              filters.partition == null
                ? "Waiting for new messages…"
                : `Waiting for new messages on partition ${filters.partition}…`
            }
          />
        </>
      ) : (
        <>
          {messages.error && <ErrorState error={messages.error} onRetry={() => messages.refetch()} />}
          {messages.isPending && <LoadingRows rows={10} />}
          {messages.data && pager && (
            <MessageTable
              messages={messages.data.messages}
              pager={pager}
              onSelect={setSelected}
              checked={readOnly ? undefined : checked}
              onCheckedChange={setChecked}
              emptyText="No messages in this range."
            />
          )}
        </>
      )}
      <MessageSheet
        clusterId={clusterId}
        topic={topic}
        targets={copyTargets}
        readOnly={readOnly}
        message={selected}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}

/** Adapts one server page to the table's pager; `page` is 0-based. */
function serverPager(
  data: BrowsePage,
  page: number,
  pageSize: number,
  hasNext: boolean,
  actions: Pick<Pager<KafkaMessage>, "setPage" | "setPageSize">,
): Pager<KafkaMessage> {
  const from = data.messages.length === 0 ? 0 : page * pageSize + 1;
  return {
    items: data.messages,
    page,
    // The total is an upper bound on compacted topics, so never claim fewer pages than reached.
    pageCount: Math.max(page + 1, Math.ceil(data.total / pageSize)),
    from,
    to: from === 0 ? 0 : from + data.messages.length - 1,
    total: data.total,
    pageSize,
    hasNext,
    ...actions,
  };
}

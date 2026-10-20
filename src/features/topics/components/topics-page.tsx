import { RegexIcon, RotateCwIcon, SearchIcon, Trash2Icon, XIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { useClusterId, useNavigation } from "@/app/stores/navigation-store";
import { PageHeader } from "@/components/page-header";
import { SortableTableHead } from "@/components/sortable-table-head";
import { TableFrame } from "@/components/table-frame";
import { ErrorState, LoadingRows } from "@/components/query-states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useColumnResize } from "@/hooks/use-column-resize";
import { usePagination } from "@/hooks/use-pagination";
import { useRowNavigation } from "@/hooks/use-row-navigation";
import { useSort, type SortColumns } from "@/hooks/use-sort";
import { useViewSearch, useViewState } from "@/hooks/use-view-state";
import { formatNumber } from "@/lib/format";
import { nameFilter } from "@/lib/name-search";

import { useTopics } from "../queries";
import type { TopicSummary } from "../types";
import { CreateTopicDialog } from "./create-topic-dialog";
import { DeleteTopicButton } from "./delete-topic-button";
import { DeleteTopicsDialog } from "./delete-topics-dialog";

const COLUMNS: SortColumns<TopicSummary, "name" | "partitions" | "replicas" | "messages"> = {
  name: (t) => t.name,
  partitions: (t) => t.partitions,
  replicas: (t) => t.replicationFactor,
  messages: (t) => t.messageCount,
};

export function TopicsPage() {
  const clusterId = useClusterId();
  const navigate = useNavigation((s) => s.navigate);
  const topics = useTopics(clusterId);
  const [searchInput, search, setSearchInput] = useViewSearch("topics.search");
  const [showInternal, setShowInternal] = useViewState("topics.showInternal", false);
  const [regex, setRegex] = useViewState("topics.searchRegex", false);

  // Compiled once per search, not once per topic.
  const filter = useMemo(() => nameFilter(search, regex), [search, regex]);
  const visible = useMemo(
    () => (topics.data ?? []).filter((t) => (showInternal || !t.internal) && filter.matches(t.name)),
    [topics.data, filter, showInternal]
  );
  const openTopic = (topic: string) => navigate({ page: "topic", topic });

  const sorter = useSort("topics", visible, COLUMNS);
  const pager = usePagination(sorter.rows, `${search}|${regex}|${showInternal}|${sorter.key}`);
  const resize = useColumnResize("topics", 6);
  const rowProps = useRowNavigation(pager.items.length);

  // Only topics matching the filter count as selected, so a filter can't hide
  // a topic that is about to be deleted. Selection survives paging; the
  // header checkbox selects the current page.
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const selectable = useMemo(() => visible.filter((t) => !t.internal).map((t) => t.name), [visible]);
  const selected = useMemo(() => selectable.filter((name) => checked.has(name)), [selectable, checked]);
  const pageSelectable = pager.items.filter((t) => !t.internal).map((t) => t.name);
  const pageSelected = pageSelectable.filter((name) => checked.has(name)).length;
  const allSelected = pageSelectable.length > 0 && pageSelected === pageSelectable.length;

  function togglePage() {
    const next = new Set(checked);
    for (const name of pageSelectable) {
      if (allSelected) next.delete(name);
      else next.add(name);
    }
    setChecked(next);
  }

  function toggle(name: string, on: boolean) {
    const next = new Set(checked);
    if (on) next.add(name);
    else next.delete(name);
    setChecked(next);
  }

  return (
    <>
      <PageHeader
        title="Topics"
        description={topics.data ? `${visible.length} of ${topics.data.length} topics` : undefined}
        actions={
          <>
            <Button variant="ghost" size="icon-sm" aria-label="Refresh" onClick={() => topics.refetch()}>
              <RotateCwIcon className={topics.isFetching ? "animate-spin" : undefined} />
            </Button>
            <CreateTopicDialog clusterId={clusterId} onCreated={openTopic} />
          </>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col gap-4 p-4">
        <div className="flex items-center gap-4">
          <div className="flex w-full max-w-sm flex-col gap-1">
            <InputGroup>
              <InputGroupAddon>
                <SearchIcon />
              </InputGroupAddon>
              <InputGroupInput
                placeholder={regex ? "Filter topics by regex" : "Filter topics"}
                aria-label="Filter topics"
                aria-invalid={filter.error !== null}
                aria-describedby={filter.error ? "topics-filter-error" : undefined}
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
              <InputGroupAddon align="inline-end">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <InputGroupButton
                      size="icon-xs"
                      variant={regex ? "secondary" : "ghost"}
                      aria-label="Use regular expression"
                      aria-pressed={regex}
                      onClick={() => setRegex(!regex)}
                    >
                      <RegexIcon />
                    </InputGroupButton>
                  </TooltipTrigger>
                  <TooltipContent>Use regular expression</TooltipContent>
                </Tooltip>
              </InputGroupAddon>
            </InputGroup>
            {filter.error && (
              <p id="topics-filter-error" className="text-xs text-destructive">
                Invalid regex: {filter.error}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Switch id="show-internal" checked={showInternal} onCheckedChange={setShowInternal} />
            <Label htmlFor="show-internal">Show internal</Label>
          </div>
        </div>

        {selected.length > 0 && (
          <div className="flex items-center gap-2 rounded-lg border bg-muted/50 px-3 py-1.5 text-sm">
            <span>
              <span className="font-medium tabular-nums">{selected.length}</span> selected
            </span>
            <Button variant="ghost" size="xs" onClick={() => setChecked(new Set())}>
              <XIcon /> Clear
            </Button>
            <div className="flex-1" />
            <Button variant="destructive" size="sm" onClick={() => setConfirmOpen(true)}>
              <Trash2Icon /> Delete {selected.length} {selected.length === 1 ? "topic" : "topics"}
            </Button>
          </div>
        )}

        {topics.error && <ErrorState error={topics.error} onRetry={() => topics.refetch()} />}
        {topics.isPending && <LoadingRows />}
        {topics.data && (
          <TableFrame pager={pager}>
            <Table resize={resize} aria-label="Topics. Use the arrow keys to move between rows and Enter to open one.">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      aria-label="Select all topics on this page"
                      disabled={pageSelectable.length === 0}
                      checked={allSelected ? true : pageSelected > 0 ? "indeterminate" : false}
                      onCheckedChange={togglePage}
                    />
                  </TableHead>
                  <SortableTableHead column="name" sort={sorter.sort} onSort={sorter.toggle}>
                    Name
                  </SortableTableHead>
                  <SortableTableHead column="partitions" sort={sorter.sort} onSort={sorter.toggle} align="right" className="w-28">
                    Partitions
                  </SortableTableHead>
                  <SortableTableHead column="replicas" sort={sorter.sort} onSort={sorter.toggle} align="right" className="w-28">
                    Replicas
                  </SortableTableHead>
                  <SortableTableHead column="messages" sort={sorter.sort} onSort={sorter.toggle} align="right" className="w-36">
                    Messages
                  </SortableTableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {pager.items.map((t, i) => (
                  <TableRow
                    key={t.name}
                    {...rowProps(i, () => openTopic(t.name))}
                    data-state={checked.has(t.name) ? "selected" : undefined}
                  >
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      {!t.internal && (
                        <Checkbox
                          aria-label={`Select ${t.name}`}
                          checked={checked.has(t.name)}
                          onCheckedChange={(on) => toggle(t.name, on === true)}
                        />
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-mono">{t.name}</span>
                        {t.internal && <Badge variant="outline">internal</Badge>}
                        {t.underReplicatedPartitions > 0 && (
                          <Badge variant="destructive">{t.underReplicatedPartitions} under-replicated</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{t.partitions}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{t.replicationFactor}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{formatNumber(t.messageCount)}</TableCell>
                    {/* React events bubble out of the dialog's portal, so keep its clicks from opening the row. */}
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      {!t.internal && (
                        <DeleteTopicButton
                          clusterId={clusterId}
                          topic={t.name}
                          trigger={
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              aria-label={`Delete ${t.name}`}
                              className="text-muted-foreground hover:text-destructive"
                            >
                              <Trash2Icon />
                            </Button>
                          }
                        />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {visible.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                      No topics found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableFrame>
        )}
      </div>
      <DeleteTopicsDialog
        clusterId={clusterId}
        topics={selected}
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        onDone={(failed) => {
          setConfirmOpen(false);
          setChecked(new Set(failed));
        }}
      />
    </>
  );
}

import { RotateCwIcon, SearchIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { useClusterId } from "@/app/stores/navigation-store";
import { PageHeader } from "@/components/page-header";
import { ErrorState, LoadingRows } from "@/components/query-states";
import { SortableTableHead } from "@/components/sortable-table-head";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { TableFrame } from "@/components/table-frame";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { useColumnResize } from "@/hooks/use-column-resize";
import { usePagination } from "@/hooks/use-pagination";
import { useRowNavigation } from "@/hooks/use-row-navigation";
import { useSort, type SortColumns } from "@/hooks/use-sort";
import { useViewState } from "@/hooks/use-view-state";
import { formatNumber } from "@/lib/format";

import { useConsumerGroupLags, useConsumerGroups } from "../queries";
import type { GroupLag, GroupSummary } from "../types";
import { GroupDetailSheet } from "./group-detail-sheet";
import { GroupStateBadge } from "./group-state-badge";

export function ConsumerGroupsPage() {
  const clusterId = useClusterId();
  const groups = useConsumerGroups(clusterId);
  const lags = useConsumerGroupLags(clusterId);
  const lagByGroup = useMemo(() => new Map((lags.data ?? []).map((l) => [l.name, l])), [lags.data]);
  const [search, setSearch] = useViewState("consumer-groups.search", "");
  const [selected, setSelected] = useState<string | null>(null);

  const visible = useMemo(
    () => (groups.data ?? []).filter((g) => g.name.toLowerCase().includes(search.toLowerCase())),
    [groups.data, search]
  );
  // Topics and lag come from a separate query, so these columns read the lag map.
  const columns = useMemo<SortColumns<GroupSummary, "name" | "state" | "topics" | "assignor" | "members" | "lag">>(
    () => ({
      name: (g) => g.name,
      state: (g) => g.state,
      topics: (g) => lagByGroup.get(g.name)?.topics.length,
      assignor: (g) => g.protocol || null,
      members: (g) => g.members,
      lag: (g) => lagByGroup.get(g.name)?.lag,
    }),
    [lagByGroup]
  );
  const sorter = useSort("consumer-groups", visible, columns);
  const pager = usePagination(sorter.rows, `${search}|${sorter.key}`);
  const resize = useColumnResize("consumer-groups", 6);
  const rowProps = useRowNavigation(pager.items.length);

  function refresh() {
    groups.refetch();
    lags.refetch();
  }

  return (
    <>
      <PageHeader
        title="Consumer groups"
        description={groups.data ? `${groups.data.length} groups` : undefined}
        actions={
          <Button variant="ghost" size="icon-sm" aria-label="Refresh" onClick={refresh}>
            <RotateCwIcon className={groups.isFetching || lags.isFetching ? "animate-spin" : undefined} />
          </Button>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col gap-4 p-4">
        <div className="relative max-w-sm">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Filter groups"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {groups.error && <ErrorState error={groups.error} onRetry={() => groups.refetch()} />}
        {groups.isPending && <LoadingRows />}
        {groups.data && (
          <TableFrame pager={pager}>
            <Table resize={resize} aria-label="Consumer groups. Use the arrow keys to move between rows and Enter to open one.">
              <TableHeader>
                <TableRow>
                  <SortableTableHead column="name" sort={sorter.sort} onSort={sorter.toggle}>
                    Group
                  </SortableTableHead>
                  <SortableTableHead column="state" sort={sorter.sort} onSort={sorter.toggle} className="w-44">
                    State
                  </SortableTableHead>
                  <SortableTableHead column="topics" sort={sorter.sort} onSort={sorter.toggle}>
                    Topics
                  </SortableTableHead>
                  <SortableTableHead column="assignor" sort={sorter.sort} onSort={sorter.toggle} className="w-32">
                    Assignor
                  </SortableTableHead>
                  <SortableTableHead column="members" sort={sorter.sort} onSort={sorter.toggle} align="right" className="w-24">
                    Members
                  </SortableTableHead>
                  <SortableTableHead column="lag" sort={sorter.sort} onSort={sorter.toggle} align="right" className="w-32">
                    Lag
                  </SortableTableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pager.items.map((g, i) => (
                  <TableRow key={g.name} {...rowProps(i, () => setSelected(g.name))}>
                    <TableCell className="font-mono">{g.name}</TableCell>
                    <TableCell>
                      <GroupStateBadge state={g.state} />
                    </TableCell>
                    <TableCell>
                      <TopicsCell lag={lagByGroup.get(g.name)} loading={lags.isPending} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">{g.protocol || "—"}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{g.members}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      <LagCell lag={lagByGroup.get(g.name)} loading={lags.isPending} />
                    </TableCell>
                  </TableRow>
                ))}
                {visible.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                      No consumer groups found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableFrame>
        )}
      </div>
      <GroupDetailSheet clusterId={clusterId} group={selected} onClose={() => setSelected(null)} />
    </>
  );
}

/** Shows a few topic names; the rest go in a "+N" badge. */
function TopicsCell({ lag, loading }: { lag: GroupLag | undefined; loading: boolean }) {
  if (loading) return <Skeleton className="h-4 w-32" />;
  if (!lag || lag.topics.length === 0) return <span className="text-muted-foreground">—</span>;
  const shown = lag.topics.slice(0, 2);
  return (
    <div className="flex flex-wrap gap-1" title={lag.topics.join("\n")}>
      {shown.map((t) => (
        <Badge key={t} variant="outline" className="font-mono">
          {t}
        </Badge>
      ))}
      {lag.topics.length > shown.length && <Badge variant="secondary">+{lag.topics.length - shown.length}</Badge>}
    </div>
  );
}

function LagCell({ lag, loading }: { lag: GroupLag | undefined; loading: boolean }) {
  if (loading) return <Skeleton className="ml-auto h-4 w-12" />;
  if (lag?.lag == null) return <span className="text-muted-foreground">—</span>;
  return (
    <span className={lag.lag > 0 ? "text-amber-600 dark:text-amber-400" : undefined}>{formatNumber(lag.lag)}</span>
  );
}

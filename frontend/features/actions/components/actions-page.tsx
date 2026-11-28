import { ArrowDown01Icon, PlusSignIcon, Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useMemo, useState, type ComponentProps } from "react";

import { useClusterId, useNavigation } from "@/app/stores/navigation-store";
import { PageHeader } from "@/components/page-header";
import { ErrorState, LoadingText } from "@/components/query-states";
import { SortableTableHead } from "@/components/sortable-table-head";
import { TableFrame } from "@/components/table-frame";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableStateRow } from "@/components/ui/table";
import { useColumnResize } from "@/hooks/use-column-resize";
import { usePagination } from "@/hooks/use-pagination";
import { useRowNavigation } from "@/hooks/use-row-navigation";
import { useSort, type SortColumns } from "@/hooks/use-sort";
import { useViewSearch } from "@/hooks/use-view-state";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

import { DESTINATIONS, destinationOf, type AvailableDestination, type ExecutorKind } from "../destinations";
import { isActive } from "../draft";
import { useActions, useActionStatuses } from "../queries";
import type { Action, RunState, RunStatus } from "../types";
import { DestinationCatalog } from "./destination-catalog";
import { DestinationIcon } from "./destination-icon";
import { NewActionSheet } from "./new-action-sheet";
import { RefreshActionsButton } from "./refresh-actions-button";
import { RunControls } from "./run-controls";
import { ExportActionsButton, ImportActionsButton } from "./share-buttons";
import { RunStateBadge } from "./status-badges";

export function ActionsPage() {
  const clusterId = useClusterId();
  const navigate = useNavigation((s) => s.navigate);
  const actions = useActions(clusterId);
  const statuses = useActionStatuses(clusterId);
  const [creating, setCreating] = useState<ExecutorKind | null>(null);
  const statusOf = useCallback((id: string) => statuses.data?.find((s) => s.actionId === id), [statuses.data]);
  const list = actions.data ?? [];
  const running = (statuses.data ?? []).filter((s) => isActive(s.state)).length;
  const create = (destination: AvailableDestination) => setCreating(destination.kind);
  const open = (action: Action) => navigate({ page: "action", actionId: action.id });

  return (
    <>
      <PageHeader
        title="Actions"
        description={
          actions.data
            ? `${list.length} action${list.length === 1 ? "" : "s"}${running ? ` · ${running} running` : ""}`
            : undefined
        }
        actions={
          <>
            <RefreshActionsButton clusterId={clusterId} />
            {list.length > 0 && (
              <>
                <ImportActionsButton clusterId={clusterId} />
                <ExportActionsButton clusterId={clusterId} actionIds={list.map((a) => a.id)} label="Export all" />
                <NewActionMenu onSelect={create} />
              </>
            )}
          </>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4">
        {actions.error && <ErrorState error={actions.error} onRetry={() => actions.refetch()} />}
        {actions.isPending && <LoadingText />}
        {actions.data && list.length === 0 && <GettingStarted clusterId={clusterId} onSelect={create} />}
        {list.length > 0 && (
          <ActionsTable
            clusterId={clusterId}
            actions={list}
            statusOf={statusOf}
            onOpen={open}
          />
        )}
      </div>

      <NewActionSheet clusterId={clusterId} kind={creating} onClose={() => setCreating(null)} />
    </>
  );
}

const STATE_ORDER: Record<RunState["kind"], number> = { running: 0, starting: 1, stopping: 2, failed: 3, stopped: 4 };

type ActionColumn = "name" | "state" | "topic" | "function" | "processed" | "failed";

interface ActionsTableProps {
  clusterId: string;
  actions: Action[];
  statusOf: (id: string) => RunStatus | undefined;
  onOpen: (action: Action) => void;
}

function ActionsTable({ clusterId, actions, statusOf, onOpen }: ActionsTableProps) {
  const [searchInput, search, setSearchInput] = useViewSearch("actions.search");
  const visible = useMemo(() => {
    const needle = search.toLowerCase();
    return actions.filter((a) =>
      [a.name, a.source.topic, a.executor.functionName].some((field) => field.toLowerCase().includes(needle))
    );
  }, [actions, search]);
  const columns = useMemo<SortColumns<Action, ActionColumn>>(
    () => ({
      name: (a) => a.name,
      state: (a) => STATE_ORDER[statusOf(a.id)?.state.kind ?? "stopped"],
      topic: (a) => a.source.topic,
      function: (a) => a.executor.functionName,
      processed: (a) => statusOf(a.id)?.processed ?? 0,
      failed: (a) => statusOf(a.id)?.failed ?? 0,
    }),
    [statusOf]
  );
  const sorter = useSort("actions", visible, columns);
  const pager = usePagination(sorter.rows, `${search}|${sorter.key}`);
  const resize = useColumnResize("actions", 7, [clusterId]);
  const rowProps = useRowNavigation(pager.items.length);

  return (
    <>
      <div className="relative max-w-sm">
        <HugeiconsIcon
          icon={Search01Icon}
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          className="pl-8"
          placeholder="Filter actions"
          aria-label="Filter actions by name, topic or function"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
      </div>
      <TableFrame pager={pager}>
        <Table resize={resize} aria-label="Actions. Use the arrow keys to move between rows and Enter to open one.">
          <TableHeader>
            <TableRow>
              <SortableTableHead column="name" sort={sorter.sort} onSort={sorter.toggle}>
                Name
              </SortableTableHead>
              <SortableTableHead column="state" sort={sorter.sort} onSort={sorter.toggle} className="w-32">
                Status
              </SortableTableHead>
              <SortableTableHead column="topic" sort={sorter.sort} onSort={sorter.toggle}>
                Topic
              </SortableTableHead>
              <SortableTableHead column="function" sort={sorter.sort} onSort={sorter.toggle}>
                Function
              </SortableTableHead>
              <SortableTableHead column="processed" sort={sorter.sort} onSort={sorter.toggle} align="right" className="w-32">
                Processed
              </SortableTableHead>
              <SortableTableHead column="failed" sort={sorter.sort} onSort={sorter.toggle} align="right" className="w-28">
                Failed
              </SortableTableHead>
              <TableHead pinnable={false} className="w-40" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {pager.items.map((action, i) => (
              <ActionRow
                key={action.id}
                clusterId={clusterId}
                action={action}
                status={statusOf(action.id)}
                rowProps={rowProps(i, () => onOpen(action))}
              />
            ))}
            {visible.length === 0 && <TableStateRow colSpan={7}>No actions match “{search}”.</TableStateRow>}
          </TableBody>
        </Table>
      </TableFrame>
    </>
  );
}

interface ActionRowProps {
  clusterId: string;
  action: Action;
  status: RunStatus | undefined;
  rowProps: ComponentProps<typeof TableRow>;
}

function ActionRow({ clusterId, action, status, rowProps }: ActionRowProps) {
  const state = status?.state ?? { kind: "stopped" };
  const active = isActive(state);
  const destination = destinationOf(action.executor);
  const failed = status?.failed ?? 0;
  return (
    <TableRow {...rowProps}>
      <TableCell>
        <div className="flex min-w-0 items-center gap-2">
          <DestinationIcon id={destination.id} size="sm" />
          {/* The row is the keyboard target, so the name only takes clicks. */}
          <button type="button" tabIndex={-1} className="truncate text-left font-medium hover:underline">
            {action.name}
          </button>
        </div>
      </TableCell>
      <TableCell>
        <RunStateBadge state={state} />
      </TableCell>
      <TableCell className="truncate font-mono text-muted-foreground">{action.source.topic}</TableCell>
      <TableCell className="truncate font-mono text-muted-foreground">{action.executor.functionName}</TableCell>
      <TableCell className="text-right font-mono tabular-nums">
        {formatNumber(status?.processed ?? 0)}
        {active && <span className="ml-1.5 text-xs text-muted-foreground">+{status?.inFlight ?? 0}</span>}
      </TableCell>
      <TableCell className={cn("text-right font-mono tabular-nums", failed > 0 ? "text-destructive" : "text-muted-foreground")}>
        {formatNumber(failed)}
      </TableCell>
      {/* Keep Start and Stop clicks from opening the row. */}
      <TableCell onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-end gap-1">
          <RunControls clusterId={clusterId} action={action} state={state} />
        </div>
      </TableCell>
    </TableRow>
  );
}

function NewActionMenu({ onSelect }: { onSelect: (destination: AvailableDestination) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm">
          <HugeiconsIcon icon={PlusSignIcon} /> New action <HugeiconsIcon icon={ArrowDown01Icon} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Send to</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {DESTINATIONS.map((d) => (
          <DropdownMenuItem
            key={d.id}
            disabled={d.status === "planned"}
            onSelect={() => d.status === "available" && onSelect(d)}
          >
            <DestinationIcon id={d.id} size="sm" />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate">{d.title}</span>
              <span className="truncate text-xs text-muted-foreground">{d.runtime}</span>
            </span>
            {d.status === "planned" && <Badge variant="secondary">Soon</Badge>}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface GettingStartedProps {
  clusterId: string;
  onSelect: (destination: AvailableDestination) => void;
}

function GettingStarted({ clusterId, onSelect }: GettingStartedProps) {
  return (
    <div className="page-enter mx-auto flex w-full max-w-3xl flex-col gap-6 py-10">
      <div className="flex flex-col items-center gap-1.5 text-center">
        <h2 className="text-lg font-semibold">Run your local code on every Kafka message</h2>
        <p className="text-sm text-muted-foreground">
          Pick where each new message on a topic should go, or import actions a teammate shared.
        </p>
        <div className="pt-2">
          <ImportActionsButton clusterId={clusterId} />
        </div>
      </div>
      <DestinationCatalog onSelect={onSelect} />
    </div>
  );
}

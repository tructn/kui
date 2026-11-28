import { AlertCircleIcon, ArrowRight02Icon, Delete02Icon, LockIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState, type ReactNode } from "react";

import { useClusterId, useNavigation } from "@/app/stores/navigation-store";
import { ColumnFilterButton, type FilterOption } from "@/components/column-filter-button";
import { PageHeader } from "@/components/page-header";
import { ErrorState, LoadingText } from "@/components/query-states";
import { StatCard } from "@/components/stat-card";
import { TableFrame } from "@/components/table-frame";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableStateRow } from "@/components/ui/table";
import { useColumnFilters, type ColumnFiltering } from "@/hooks/use-column-filters";
import { useRowNavigation } from "@/hooks/use-row-navigation";
import type { FilterColumns } from "@/lib/column-filter";
import { formatNumber, formatTimestamp } from "@/lib/format";
import { cn } from "@/lib/utils";

import { destinationOf } from "../destinations";
import { emptyHistoryText, formatDuration, isActive } from "../draft";
import { useActionHistory, useActions, useActionStatuses, useClearHistory, useExecution } from "../queries";
import type { Action, ExecutionStatus, ExecutionSummary, RunStatus } from "../types";
import { ActionEditorForm } from "./action-editor-form";
import { DeleteActionDialog } from "./delete-action-dialog";
import { ExportActionsButton } from "./share-buttons";
import { DestinationIcon } from "./destination-icon";
import { ExecutionView } from "./execution-view";
import { RefreshActionsButton } from "./refresh-actions-button";
import { RunControls } from "./run-controls";
import { EXECUTION_LABELS, ExecutionStatusBadge, ExecutionStatusInfo, RunStateBadge } from "./status-badges";

type HistoryColumn = "started" | "message" | "key" | "status";

const HISTORY_FILTERS: FilterColumns<ExecutionSummary, HistoryColumn> = {
  started: (row) => formatTimestamp(row.startedAt),
  message: (row) => `${row.partition}@${row.offset}`,
  key: (row) => row.key ?? "",
  status: (row) => row.status,
};

const STATUS_OPTIONS: FilterOption[] = (Object.keys(EXECUTION_LABELS) as ExecutionStatus[]).map((status) => ({
  value: status,
  label: EXECUTION_LABELS[status],
}));

/** One Action: its run history and logs on the left, its settings on the right. */
export function ActionPage({ actionId }: { actionId: string }) {
  const clusterId = useClusterId();
  const navigate = useNavigation((s) => s.navigate);
  const actions = useActions(clusterId);
  const statuses = useActionStatuses(clusterId);
  const action = actions.data?.find((a) => a.id === actionId);
  const status = statuses.data?.find((s) => s.actionId === actionId);
  const crumbs = [{ label: "Actions", onSelect: () => navigate({ page: "actions" }) }];

  if (!action) {
    return (
      <>
        <PageHeader crumbs={crumbs} title="Action" />
        <div className="p-4">
          {actions.error && <ErrorState error={actions.error} onRetry={() => actions.refetch()} />}
          {actions.isPending && <LoadingText />}
          {actions.data && <p className="text-sm text-muted-foreground">This action no longer exists.</p>}
        </div>
      </>
    );
  }

  const state = status?.state ?? { kind: "stopped" };
  return (
    <>
      <PageHeader
        crumbs={crumbs}
        title={
          <span className="flex items-center gap-2">
            {action.name}
            <RunStateBadge state={state} />
          </span>
        }
        description={
          <span className="flex items-center gap-1.5 font-mono">
            {action.source.topic}
            <HugeiconsIcon icon={ArrowRight02Icon} className="size-3" aria-label="invokes" />
            {action.executor.functionName}
          </span>
        }
        actions={
          <>
            <RefreshActionsButton clusterId={clusterId} />
            <ExportActionsButton clusterId={clusterId} actionIds={[action.id]} />
            <RunControls clusterId={clusterId} action={action} state={state} />
          </>
        }
      />
      <div className="flex min-h-0 flex-1">
        <ActivityPanel action={action} status={status} />
        <SettingsPane
          clusterId={clusterId}
          action={action}
          locked={isActive(state)}
          onDeleted={() => navigate({ page: "actions" })}
        />
      </div>
    </>
  );
}

function ActivityPanel({ action, status }: { action: Action; status: RunStatus | undefined }) {
  const state = status?.state ?? { kind: "stopped" };
  const history = useActionHistory(action.id, isActive(state));
  const clear = useClearHistory();
  const [selected, setSelected] = useState<number | null>(null);
  const all = history.data ?? [];
  // History holds at most 500 rows and is already fetched whole, so filtering here costs no round trip.
  const filtering = useColumnFilters("actions.history", all, HISTORY_FILTERS);
  const rows = filtering.rows;
  const rowProps = useRowNavigation(rows.length);
  // The newest row until the user picks one, so a run's result shows without a click.
  const shown = selected ?? rows[0]?.id ?? null;

  return (
    <section aria-label="Run history" className="flex min-w-0 flex-1 flex-col gap-4 overflow-auto p-4">
      {state.kind === "failed" && (
        <Alert variant="destructive">
          <HugeiconsIcon icon={AlertCircleIcon} />
          <AlertTitle>The action stopped</AlertTitle>
          <AlertDescription className="font-mono text-code break-all">{state.message}</AlertDescription>
        </Alert>
      )}
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Processed" value={formatNumber(status?.processed ?? 0)} />
        <StatCard label="Failed" value={formatNumber(status?.failed ?? 0)} warning={(status?.failed ?? 0) > 0} />
        <StatCard
          label="Started"
          value={<span className="text-sm">{status?.startedAt ? formatTimestamp(status.startedAt) : "—"}</span>}
          info="Counters are for the latest run. History keeps the last 500 executions until KUI quits."
        />
      </div>

      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Executions</h2>
        <Button
          size="sm"
          variant="ghost"
          disabled={all.length === 0 || clear.isPending}
          onClick={() => {
            setSelected(null);
            clear.mutate(action.id);
          }}
        >
          <HugeiconsIcon icon={Delete02Icon} /> Clear history
        </Button>
      </div>
      <TableFrame fill={false} className="max-h-96 shrink-0">
        <Table aria-label="Execution history, newest first. Use the arrow keys to move between rows and Enter to show one.">
          <TableHeader>
            <TableRow>
              <FilterHead className="w-60" label="Started" column="started" filtering={filtering} />
              <FilterHead className="w-32" label="Message" column="message" filtering={filtering} />
              <FilterHead label="Key" column="key" filtering={filtering} />
              <FilterHead className="w-40" label="Status" column="status" filtering={filtering} options={STATUS_OPTIONS}
                info={<ExecutionStatusInfo />}
              />
              <TableHead className="w-24 text-right">Duration</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, i) => {
              const nav = rowProps(i, () => setSelected(row.id));
              return (
              <TableRow
                key={row.id}
                data-state={row.id === shown ? "selected" : undefined}
                {...nav}
                // New executions are prepended, which would flip every row's `even:` stripe on each poll.
                // Striping by id keeps each row's colour fixed. (Both classes carry `even:` to replace the row's own.)
                className={cn(
                  nav.className,
                  row.id % 2 === 1
                    ? "[--row-tint:var(--color-row-stripe)] even:[--row-tint:var(--color-row-stripe)]"
                    : "even:[--row-tint:transparent]",
                )}
              >
                <TableCell className="font-mono tabular-nums">{formatTimestamp(row.startedAt)}</TableCell>
                <TableCell className="font-mono tabular-nums">
                  {row.partition}@{row.offset}
                </TableCell>
                <TableCell className="max-w-0 truncate font-mono text-muted-foreground">{row.key ?? "—"}</TableCell>
                <TableCell>
                  <ExecutionStatusBadge status={row.status} />
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">{formatDuration(row.durationMs)}</TableCell>
              </TableRow>
              );
            })}
            {rows.length === 0 && (
              <TableStateRow colSpan={5}>
                {history.isPending ? (
                  <LoadingText />
                ) : all.length > 0 ? (
                  <span className="inline-flex items-center gap-2">
                    No executions match the filters.
                    <Button size="sm" variant="link" className="h-auto p-0" onClick={filtering.clear}>
                      Clear filters
                    </Button>
                  </span>
                ) : (
                  emptyHistoryText(action, state, status?.inFlight ?? 0)
                )}
              </TableStateRow>
            )}
          </TableBody>
        </Table>
      </TableFrame>

      {shown != null && <ExecutionPanel actionId={action.id} executionId={shown} />}
    </section>
  );
}

interface SettingsPaneProps {
  clusterId: string;
  action: Action;
  locked: boolean;
  onDeleted: () => void;
}

function SettingsPane({ clusterId, action, locked, onDeleted }: SettingsPaneProps) {
  // Bumping the key remounts the form, which drops unsaved edits.
  const [revision, setRevision] = useState(0);
  const destination = destinationOf(action.executor);
  return (
    <aside aria-label="Action settings" className="flex w-[min(30rem,45%)] shrink-0 flex-col border-l">
      <ActionEditorForm
        key={revision}
        clusterId={clusterId}
        action={action}
        kind={action.executor.kind}
        locked={locked}
        cancelLabel="Discard changes"
        onCancel={() => setRevision((r) => r + 1)}
        trailing={<DangerZone clusterId={clusterId} action={action} locked={locked} onDeleted={onDeleted} />}
        header={
          <header className="flex flex-col gap-3 border-b px-5 py-4">
            <div className="flex items-center gap-3">
              <DestinationIcon id={destination.id} size="sm" />
              <div className="flex min-w-0 flex-col">
                <h2 className="text-sm font-semibold">Settings</h2>
                <p className="truncate text-xs text-muted-foreground">
                  {destination.title} · {destination.runtime}
                </p>
              </div>
            </div>
            {locked && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <HugeiconsIcon icon={LockIcon} className="size-3.5" /> Stop the action to change its settings.
              </p>
            )}
          </header>
        }
      />
    </aside>
  );
}

function DangerZone({ clusterId, action, locked, onDeleted }: SettingsPaneProps) {
  const [confirming, setConfirming] = useState(false);
  return (
    <section aria-labelledby="action-danger-zone" className="flex flex-col gap-3 py-6">
      <header className="flex flex-col gap-0.5">
        <h3 id="action-danger-zone" className="text-sm font-semibold text-destructive">
          Danger zone
        </h3>
        <p className="text-xs text-muted-foreground">
          {locked ? "Stop the action to delete it." : "Deletes the action and its history. Its consumer group stays on the cluster."}
        </p>
      </header>
      <div className="flex items-center justify-between gap-3 rounded-md border border-destructive/40 p-3">
        <span className="text-sm">Delete this action</span>
        <Button
          type="button"
          size="sm"
          variant="destructive"
          aria-label={`Delete ${action.name}`}
          disabled={locked}
          onClick={() => setConfirming(true)}
        >
          <HugeiconsIcon icon={Delete02Icon} /> Delete
        </Button>
      </div>
      <DeleteActionDialog
        clusterId={clusterId}
        action={action}
        open={confirming}
        onOpenChange={setConfirming}
        onDeleted={onDeleted}
      />
    </section>
  );
}

interface FilterHeadProps {
  label: string;
  column: HistoryColumn;
  filtering: ColumnFiltering<ExecutionSummary, HistoryColumn>;
  options?: readonly FilterOption[];
  info?: ReactNode;
  className?: string;
}

function FilterHead({ label, column, filtering, options, info, className }: FilterHeadProps) {
  return (
    <TableHead className={className}>
      <span className="inline-flex items-center gap-1 align-middle">
        {label}
        {info}
        <ColumnFilterButton
          label={label}
          filter={filtering.filters[column]}
          onChange={(filter) => filtering.setFilter(column, filter)}
          options={options}
        />
      </span>
    </TableHead>
  );
}

function ExecutionPanel({ actionId, executionId }: { actionId: string; executionId: number }) {
  const execution = useExecution(actionId, executionId);
  const detail = execution.data;
  if (execution.isPending) return <LoadingText />;
  if (!detail) return <p className="text-sm text-muted-foreground">This execution is no longer in the history.</p>;
  // Keyed by the shown detail, not the selection, so the tabs reset only once the new execution has loaded.
  return <ExecutionView key={detail.id} detail={detail} />;
}

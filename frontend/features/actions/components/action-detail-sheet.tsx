import {
  AlertCircleIcon,
  ArrowRight02Icon,
  Delete02Icon,
  PencilEdit02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useRef, useState } from "react";

import { ResizableSheetContent } from "@/components/resizable-sheet-content";
import { StatCard } from "@/components/stat-card";
import { TableFrame } from "@/components/table-frame";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableStateRow } from "@/components/ui/table";
import { useRowNavigation } from "@/hooks/use-row-navigation";
import { LoadingText } from "@/components/query-states";
import { formatNumber, formatTimestamp } from "@/lib/format";

import { formatDuration, isActive } from "../draft";
import { useActionHistory, useClearHistory, useExecution } from "../queries";
import type { Action, RunStatus } from "../types";
import { ExecutionView } from "./execution-view";
import { RunControls } from "./run-controls";
import { ExecutionStatusBadge, RunStateBadge } from "./status-badges";

interface ActionDetailSheetProps {
  clusterId: string;
  /** Action to show; null closes the sheet. */
  action: Action | null;
  status: RunStatus | undefined;
  onEdit: (action: Action) => void;
  onClose: () => void;
}

export function ActionDetailSheet({ clusterId, action, status, onEdit, onClose }: ActionDetailSheetProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  return (
    <Sheet open={action != null} onOpenChange={(open) => !open && onClose()}>
      <ResizableSheetContent
        ref={contentRef}
        panelId="action-detail"
        defaultWidth={960}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          contentRef.current?.focus();
        }}
      >
        {action && <DetailBody clusterId={clusterId} action={action} status={status} onEdit={onEdit} />}
      </ResizableSheetContent>
    </Sheet>
  );
}

function DetailBody({
  clusterId,
  action,
  status,
  onEdit,
}: {
  clusterId: string;
  action: Action;
  status: RunStatus | undefined;
  onEdit: (action: Action) => void;
}) {
  const state = status?.state ?? { kind: "stopped" };
  const live = isActive(state);
  const history = useActionHistory(action.id, live);
  const clear = useClearHistory();
  const [selected, setSelected] = useState<number | null>(null);
  const rows = history.data ?? [];
  const rowProps = useRowNavigation(rows.length);
  // The newest row until the user picks one, so a run's result shows without a click.
  const shown = selected ?? rows[0]?.id ?? null;

  return (
    <>
      <SheetHeader className="border-b">
        <div className="flex items-center gap-2">
          <SheetTitle>{action.name}</SheetTitle>
          <RunStateBadge state={state} />
        </div>
        <SheetDescription className="flex items-center gap-1.5 font-mono">
          {action.source.topic} <HugeiconsIcon icon={ArrowRight02Icon} className="size-3" aria-label="invokes" /> {action.executor.functionName}
          <Badge variant="outline" className="ml-1 font-sans">
            {action.executor.payload === "msk" ? "MSK event" : "Message value"}
          </Badge>
        </SheetDescription>
        <div className="flex flex-wrap gap-2 pt-2">
          <RunControls clusterId={clusterId} action={action} state={state} />
          <Button size="sm" variant="outline" disabled={live} onClick={() => onEdit(action)}>
            <HugeiconsIcon icon={PencilEdit02Icon} /> Edit
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={rows.length === 0 || clear.isPending}
            onClick={() => {
              setSelected(null);
              clear.mutate(action.id);
            }}
          >
            <HugeiconsIcon icon={Delete02Icon} /> Clear history
          </Button>
        </div>
      </SheetHeader>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4">
        {state.kind === "failed" && (
          <Alert variant="destructive">
            <HugeiconsIcon icon={AlertCircleIcon} />
            <AlertTitle>The action stopped</AlertTitle>
            <AlertDescription className="font-mono text-xs break-all">{state.message}</AlertDescription>
          </Alert>
        )}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label="Processed" value={formatNumber(status?.processed ?? 0)} />
          <StatCard label="Failed" value={formatNumber(status?.failed ?? 0)} warning={(status?.failed ?? 0) > 0} />
          <StatCard label="In flight" value={formatNumber(status?.inFlight ?? 0)} />
          <StatCard
            label="Started"
            value={<span className="text-sm">{status?.startedAt ? formatTimestamp(status.startedAt) : "—"}</span>}
            info="Counters are for the latest run. History keeps the last 500 executions until KUI quits."
          />
        </div>

        <TableFrame fill={false} className="max-h-80">
          <Table aria-label="Execution history, newest first. Use the arrow keys to move between rows and Enter to show one.">
            <TableHeader>
              <TableRow>
                <TableHead className="w-48">Started</TableHead>
                <TableHead className="w-32">Message</TableHead>
                <TableHead>Key</TableHead>
                <TableHead className="w-36">Status</TableHead>
                <TableHead className="w-24 text-right">Duration</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, i) => (
                <TableRow
                  key={row.id}
                  data-state={row.id === shown ? "selected" : undefined}
                  {...rowProps(i, () => setSelected(row.id))}
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
              ))}
              {rows.length === 0 && (
                <TableStateRow colSpan={5}>
                  {history.isPending ? (
                    <LoadingText />
                  ) : live ? (
                    `Waiting for messages on ${action.source.topic}…`
                  ) : (
                    "No executions yet. Start the action, then produce a message to the topic."
                  )}
                </TableStateRow>
              )}
            </TableBody>
          </Table>
        </TableFrame>

        {shown != null && <ExecutionPanel key={shown} actionId={action.id} executionId={shown} />}
      </div>
    </>
  );
}

function ExecutionPanel({ actionId, executionId }: { actionId: string; executionId: number }) {
  const execution = useExecution(actionId, executionId);
  const detail = execution.data;
  if (execution.isPending) return <LoadingText />;
  if (!detail) return <p className="text-sm text-muted-foreground">This execution is no longer in the history.</p>;
  return <ExecutionView detail={detail} />;
}

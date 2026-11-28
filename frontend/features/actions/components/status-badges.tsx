import { InfoList, InfoTip } from "@/components/info-tip";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";

import type { ExecutionStatus, RunState } from "../types";

const GOOD = "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400";
const BUSY = "bg-amber-500/15 text-amber-600 dark:text-amber-400";

export function RunStateBadge({ state }: { state: RunState }) {
  switch (state.kind) {
    case "running":
      return (
        <Badge className={GOOD}>
          <span className="size-1.5 animate-pulse rounded-full bg-current" aria-hidden /> Running
        </Badge>
      );
    case "starting":
      return (
        <Badge className={BUSY}>
          <Spinner aria-hidden /> Starting
        </Badge>
      );
    case "stopping":
      return (
        <Badge className={BUSY}>
          <Spinner aria-hidden /> Stopping
        </Badge>
      );
    case "failed":
      return <Badge variant="destructive">Failed</Badge>;
    case "stopped":
      return <Badge variant="secondary">Stopped</Badge>;
  }
}

export const EXECUTION_LABELS: Record<ExecutionStatus, string> = {
  succeeded: "Succeeded",
  functionError: "Handler error",
  failed: "Invoke failed",
  timedOut: "Timed out",
};

const EXECUTION_DESCRIPTIONS: Record<ExecutionStatus, string> = {
  succeeded: "The handler ran and returned a response.",
  functionError: "The handler ran but threw. The bug is in your code: set a breakpoint there.",
  failed: "The handler never ran: the endpoint is down, the function wasn't found or the payload was rejected.",
  timedOut: "No response in time. The handler may be slow or paused on a breakpoint.",
};

export function ExecutionStatusInfo() {
  return (
    <InfoTip label="What the statuses mean">
      <InfoList
        items={(Object.keys(EXECUTION_LABELS) as ExecutionStatus[]).map((status) => ({
          term: EXECUTION_LABELS[status],
          description: EXECUTION_DESCRIPTIONS[status],
        }))}
      />
    </InfoTip>
  );
}

export function ExecutionStatusBadge({ status }: { status: ExecutionStatus }) {
  const label = EXECUTION_LABELS[status];
  switch (status) {
    case "succeeded":
      return <Badge className={GOOD}>{label}</Badge>;
    case "timedOut":
      return <Badge className={BUSY}>{label}</Badge>;
    case "functionError":
    case "failed":
      return <Badge variant="destructive">{label}</Badge>;
  }
}

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

const EXECUTION_LABELS: Record<ExecutionStatus, string> = {
  succeeded: "Succeeded",
  functionError: "Function error",
  failed: "Failed",
  timedOut: "Timed out",
};

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

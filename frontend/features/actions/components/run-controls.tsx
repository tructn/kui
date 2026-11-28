import { PlayIcon, StopIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

import { isActive } from "../draft";
import { useStartAction, useStopAction } from "../queries";
import type { Action, RunState } from "../types";

interface RunControlsProps {
  clusterId: string;
  action: Action;
  state: RunState;
  size?: "sm" | "default";
}

/** Start or Stop, whichever applies. Starting joins the consumer group, so it's always a click. */
export function RunControls({ clusterId, action, state, size = "sm" }: RunControlsProps) {
  const start = useStartAction(clusterId);
  const stop = useStopAction(clusterId);

  if (isActive(state)) {
    const stopping = state.kind === "stopping" || stop.isPending;
    return (
      <Button
        size={size}
        variant="outline"
        disabled={stopping}
        aria-label={`Stop ${action.name}`}
        onClick={(e) => {
          e.stopPropagation();
          stop.mutate(action.id);
        }}
      >
        {stopping ? <Spinner aria-hidden /> : <HugeiconsIcon icon={StopIcon} />} {stopping ? "Stopping" : "Stop"}
      </Button>
    );
  }
  return (
    <Button
      size={size}
      disabled={start.isPending}
      aria-label={`Start ${action.name}`}
      onClick={(e) => {
        e.stopPropagation();
        start.mutate(action.id, {
          onError: (error) => toast.error(`${action.name} couldn't start`, { description: error.message }),
        });
      }}
    >
      {start.isPending ? <Spinner aria-hidden /> : <HugeiconsIcon icon={PlayIcon} />} Start
    </Button>
  );
}

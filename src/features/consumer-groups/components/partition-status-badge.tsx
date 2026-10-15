import { InfoList } from "@/components/info-tip";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

import type { PartitionStatus } from "../types";

/** Labels match the progress bar segment of the same color (see `SEGMENT_LABELS`). */
export const STATUS_META: Record<PartitionStatus, { label: string; className: string; description: string }> = {
  caughtUp: {
    label: "Caught up",
    className: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    description: "The group has read every message: its committed offset is at the end of the partition.",
  },
  behind: {
    label: "Behind",
    className: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    description: "Messages are waiting after the committed offset. Lag is how many.",
  },
  notStarted: {
    label: "Not started",
    className: "bg-muted text-muted-foreground",
    description: "The group has never committed an offset here, so none of these messages have been read.",
  },
  outOfRange: {
    label: "Out of range",
    className: "bg-destructive/15 text-destructive",
    description:
      "Retention deleted messages before the group read them, so its committed offset no longer exists. The consumer's auto.offset.reset decides where it resumes.",
  },
};

const ORDER: PartitionStatus[] = ["caughtUp", "behind", "notStarted", "outOfRange"];

/** Every status and its meaning, for an `InfoTip`. */
export function PartitionStatusInfo() {
  return <InfoList items={ORDER.map((s) => ({ term: STATUS_META[s].label, description: STATUS_META[s].description }))} />;
}

export function PartitionStatusBadge({ status }: { status: PartitionStatus }) {
  const { label, className, description } = STATUS_META[status];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge className={className}>{label}</Badge>
      </TooltipTrigger>
      <TooltipContent>{description}</TooltipContent>
    </Tooltip>
  );
}

import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

import type { PartitionOffset, PartitionStatus } from "../types";

/** Statuses the progress bar can't draw: the group has no readable position on the partition. */
export type UnreadStatus = Extract<PartitionStatus, "notStarted" | "outOfRange">;

export function isUnread(o: PartitionOffset): o is PartitionOffset & { status: UnreadStatus } {
  return o.status === "notStarted" || o.status === "outOfRange";
}

const STATUS_META: Record<UnreadStatus, { label: string; className: string; description: string }> = {
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

/** Shown in place of the progress bar when there is no position to draw. */
export function PartitionStatusBadge({ status }: { status: UnreadStatus }) {
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

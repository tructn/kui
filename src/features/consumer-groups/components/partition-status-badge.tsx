import { Badge } from "@/components/ui/badge";

import type { PartitionStatus } from "../types";

const STYLES: Record<PartitionStatus, { label: string; className: string }> = {
  caughtUp: { label: "Caught up", className: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" },
  behind: { label: "Behind", className: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
  notStarted: { label: "Not started", className: "bg-muted text-muted-foreground" },
  outOfRange: { label: "Out of range", className: "bg-destructive/15 text-destructive" },
};

export function PartitionStatusBadge({ status }: { status: PartitionStatus }) {
  const { label, className } = STYLES[status];
  return <Badge className={className}>{label}</Badge>;
}

import { ChevronRightIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

import type { PartitionOffset, TopicProgress } from "../types";
import { PartitionOffsetsTable } from "./partition-offsets-table";
import { ProgressBar, topicSegments } from "./progress-bar";

interface ProgressSectionProps {
  /** A topic name (group detail) or a group name (topic page). */
  title: ReactNode;
  /** Extra header content, e.g. a group state badge or a link. */
  extra?: ReactNode;
  progress: TopicProgress;
  offsets: PartitionOffset[];
  defaultOpen?: boolean;
}

/** One group × topic: totals and a bar, expanding to every partition. */
export function ProgressSection({ title, extra, progress, offsets, defaultOpen = false }: ProgressSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const counts = [
    [progress.caughtUp, "caught up"],
    [progress.behind, "behind"],
    [progress.notStarted, "not started"],
    [progress.outOfRange, "out of range"],
  ] as const;

  return (
    <div className="rounded-lg border">
      <div className="flex flex-col gap-2 p-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="flex min-w-0 items-center gap-1.5 text-left text-sm font-medium"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            <ChevronRightIcon className={cn("size-4 shrink-0 transition-transform", open && "rotate-90")} />
            <span className="truncate font-mono">{title}</span>
          </button>
          {extra}
          <div className="flex-1" />
          <span className="text-xs whitespace-nowrap text-muted-foreground">
            Lag{" "}
            <span
              className={cn(
                "font-mono tabular-nums",
                progress.lag > 0 ? "text-amber-600 dark:text-amber-400" : "text-foreground",
              )}
            >
              {formatNumber(progress.lag)}
            </span>
          </span>
        </div>
        <ProgressBar segments={topicSegments(progress)} />
        <p className="text-xs text-muted-foreground">
          {progress.partitions} partitions:{" "}
          {counts
            .filter(([n]) => n > 0)
            .map(([n, label]) => `${n} ${label}`)
            .join(" · ")}
        </p>
      </div>
      {open && (
        <div className="border-t">
          <PartitionOffsetsTable offsets={offsets} />
        </div>
      )}
    </div>
  );
}

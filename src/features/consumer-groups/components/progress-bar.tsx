import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

import type { PartitionOffset, TopicProgress } from "../types";

/** One color per kind of message, shared by bars, legends and badges. */
export const SEGMENT_COLORS = {
  consumed: "bg-emerald-500",
  lag: "bg-amber-500",
  untouched: "bg-muted-foreground/25",
  lost: "bg-destructive",
} as const;

type SegmentKind = keyof typeof SEGMENT_COLORS;

const SEGMENT_LABELS: Record<SegmentKind, string> = {
  consumed: "Consumed",
  lag: "Lag (waiting)",
  untouched: "Not started",
  lost: "Unread, out of range",
};

type Segments = Partial<Record<SegmentKind, number>>;

export function topicSegments(t: TopicProgress): Segments {
  return { consumed: t.consumed, lag: t.lag, untouched: t.untouched };
}

export function partitionSegments(o: PartitionOffset): Segments {
  const retained = o.high - o.low;
  switch (o.status) {
    case "notStarted":
      return { untouched: retained };
    case "outOfRange":
      // The committed offset is gone; everything still retained is unread.
      return { lost: retained };
    default:
      return { consumed: Math.min(Math.max(o.committed! - o.low, 0), retained), lag: o.lag ?? 0 };
  }
}

/** Stacked bar of consumed / waiting / untouched messages, with the numbers in a tooltip. */
export function ProgressBar({ segments, className }: { segments: Segments; className?: string }) {
  const entries = (Object.keys(SEGMENT_COLORS) as SegmentKind[])
    .map((kind) => [kind, segments[kind] ?? 0] as const)
    .filter(([, value]) => value > 0);
  const total = entries.reduce((sum, [, value]) => sum + value, 0);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* 2px surface gap between segments so adjacent colors never touch. */}
        <div className={cn("flex h-2 w-full gap-0.5", total === 0 && "rounded-full bg-muted", className)}>
          {entries.map(([kind, value]) => (
            <div
              key={kind}
              className={cn("min-w-0.5 rounded-full", SEGMENT_COLORS[kind])}
              style={{ flexGrow: value, flexBasis: 0 }}
            />
          ))}
        </div>
      </TooltipTrigger>
      <TooltipContent>
        {total === 0 ? (
          "No messages on the broker"
        ) : (
          <div className="flex flex-col gap-0.5">
            {entries.map(([kind, value]) => (
              <span key={kind} className="flex items-center gap-1.5">
                <span className={cn("size-2 rounded-full", SEGMENT_COLORS[kind])} />
                {SEGMENT_LABELS[kind]}: <span className="font-mono tabular-nums">{formatNumber(value)}</span>
              </span>
            ))}
          </div>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

/** Color key for the bars, shown once above them. */
export function ProgressLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {(["consumed", "lag", "untouched", "lost"] as const).map((kind) => (
        <span key={kind} className="flex items-center gap-1.5">
          <span className={cn("size-2 rounded-full", SEGMENT_COLORS[kind])} />
          {SEGMENT_LABELS[kind]}
        </span>
      ))}
    </div>
  );
}

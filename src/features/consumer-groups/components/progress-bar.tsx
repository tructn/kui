import { InfoList, InfoTip } from "@/components/info-tip";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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

/**
 * Each color is a kind of message, and matches the partition status of the same color
 * (Caught up / Behind / Not started / Out of range in `STATUS_META`).
 */
const SEGMENT_LABELS: Record<SegmentKind, string> = {
  consumed: "Consumed",
  lag: "Lag",
  untouched: "Not started",
  lost: "Out of range",
};

const SEGMENT_DESCRIPTIONS: Record<SegmentKind, string> = {
  consumed:
    "Messages the group has read: everything before its committed offset.",
  lag: "Messages after the committed offset, waiting to be read.",
  untouched:
    "Messages in partitions where the group has never committed an offset.",
  lost: "Messages in partitions whose committed offset was deleted by retention. The group has read none of them.",
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
      return {
        consumed: Math.min(Math.max(o.committed! - o.low, 0), retained),
        lag: o.lag ?? 0,
      };
  }
}

/** Stacked bar of consumed / lag / not-started / out-of-range messages, with the numbers in a tooltip. */
export function ProgressBar({
  segments,
  className,
}: {
  segments: Segments;
  className?: string;
}) {
  const entries = (Object.keys(SEGMENT_COLORS) as SegmentKind[])
    .map((kind) => [kind, segments[kind] ?? 0] as const)
    .filter(([, value]) => value > 0);
  const total = entries.reduce((sum, [, value]) => sum + value, 0);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* 2px surface gap between segments so adjacent colors never touch. */}
        <div
          className={cn(
            "flex h-2 w-full gap-0.5",
            total === 0 && "rounded-full bg-muted",
            className,
          )}
        >
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
                <span
                  className={cn("size-2 rounded-full", SEGMENT_COLORS[kind])}
                />
                {SEGMENT_LABELS[kind]}:{" "}
                <span className="font-mono tabular-nums">
                  {formatNumber(value)}
                </span>
              </span>
            ))}
          </div>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

const LEGEND_ORDER = ["consumed", "lag", "untouched", "lost"] as const;

/** Color key for the bars, shown once above them, with what each color means on hover. */
export function ProgressLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {LEGEND_ORDER.map((kind) => (
        <span key={kind} className="flex items-center gap-1.5">
          <span className={cn("size-2 rounded-full", SEGMENT_COLORS[kind])} />
          {SEGMENT_LABELS[kind]}
        </span>
      ))}
      <InfoTip label="What the colors mean">
        <InfoList
          items={LEGEND_ORDER.map((kind) => ({
            term: (
              <span className="flex items-center gap-1.5">
                <span
                  className={cn("size-2 rounded-full", SEGMENT_COLORS[kind])}
                />
                {SEGMENT_LABELS[kind]}
              </span>
            ),
            description: SEGMENT_DESCRIPTIONS[kind],
          }))}
        />
      </InfoTip>
    </div>
  );
}

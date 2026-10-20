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
  remaining: "bg-amber-500",
} as const;

type SegmentKind = keyof typeof SEGMENT_COLORS;
const KINDS = Object.keys(SEGMENT_COLORS) as SegmentKind[];

/** "Remaining" is Kafka's consumer lag, in plainer words. */
const SEGMENT_LABELS: Record<SegmentKind, string> = {
  consumed: "Consumed",
  remaining: "Remaining",
};

const SEGMENT_DESCRIPTIONS: Record<SegmentKind, string> = {
  consumed: "Messages the group has already read.",
  remaining: "Messages waiting for the group to read them (also called lag).",
};

type Segments = Partial<Record<SegmentKind, number>>;

export function topicSegments(t: TopicProgress): Segments {
  return { consumed: t.consumed, remaining: t.lag };
}

/** Partitions the group never read, or whose offset retention deleted, have no segments. */
export function partitionSegments(o: PartitionOffset): Segments {
  if (o.status === "notStarted" || o.status === "outOfRange") return {};
  return {
    consumed: Math.min(Math.max(o.committed! - o.low, 0), o.high - o.low),
    remaining: o.lag ?? 0,
  };
}

/** Stacked bar of consumed / remaining messages, with the numbers in a tooltip. */
export function ProgressBar({
  segments,
  emptyText = "No messages on the broker",
  className,
}: {
  segments: Segments;
  /** Tooltip when there is nothing to draw. */
  emptyText?: string;
  className?: string;
}) {
  const entries = KINDS
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
          emptyText
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

/** Color key for the bars, shown once above them, with what each color means on hover. */
export function ProgressLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {KINDS.map((kind) => (
        <span key={kind} className="flex items-center gap-1.5">
          <span className={cn("size-2 rounded-full", SEGMENT_COLORS[kind])} />
          {SEGMENT_LABELS[kind]}
        </span>
      ))}
      <InfoTip label="What the colors mean">
        <InfoList
          items={KINDS.map((kind) => ({
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

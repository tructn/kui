import { SlidersHorizontalIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useId, useRef, useState } from "react";

import { DateTimePicker } from "@/components/date-time-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

import type { BrowseFilters, StartFrom } from "../types";

const ALL_PARTITIONS = "all";
/** How long changes to the offset / time wait for the user to pause before they apply. */
const TYPING_DELAY_MS = 400;

const START_OPTIONS: { value: StartFrom; label: string }[] = [
  { value: "latest", label: "Newest" },
  { value: "earliest", label: "Oldest" },
  { value: "offset", label: "From offset" },
  { value: "timestamp", label: "From time" },
];

interface MessageFiltersProps {
  partitions: number[];
  filters: BrowseFilters;
  /** Called with the changed fields; every change re-reads the messages. */
  onChange: (patch: Partial<BrowseFilters>) => void;
  /** Live mode streams everything new, so the reading options don't apply. */
  disabled?: boolean;
}

/**
 * Popover in the query bar that edits where reading starts and which partition it reads.
 * Dropdowns apply at once, typed values after a short pause.
 */
export function MessageFilters({ partitions, filters, onChange, disabled }: MessageFiltersProps) {
  const [offset, setOffset] = useState("0");
  const [time, setTime] = useState(() => new Date(Date.now() - 60 * 60 * 1000));
  const id = useId();
  const typing = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(typing.current), []);

  function changeFrom(from: StartFrom) {
    window.clearTimeout(typing.current);
    const value = startValue(from, offset, time);
    // An empty or half-typed field starts from the beginning until it holds a valid value.
    onChange({ from, value: value === null || Number.isFinite(value) ? value : 0 });
  }

  /** Applies a typed offset or time once the user pauses; incomplete input is ignored. */
  function typeValue(from: StartFrom, nextOffset: string, nextTime: Date) {
    setOffset(nextOffset);
    setTime(nextTime);
    window.clearTimeout(typing.current);
    typing.current = window.setTimeout(() => {
      const value = startValue(from, nextOffset, nextTime);
      if (value !== null && Number.isFinite(value)) onChange({ value });
    }, TYPING_DELAY_MS);
  }

  /** The picker only reports on Done, so its value applies at once. */
  function applyTime(next: Date) {
    setTime(next);
    window.clearTimeout(typing.current);
    onChange({ value: next.getTime() });
  }

  const partition = filters.partition == null ? ALL_PARTITIONS : String(filters.partition);
  const from = filters.from;

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              disabled={disabled}
              aria-label={`Reading options: ${summary(filters)}`}
            >
              <HugeiconsIcon
                icon={SlidersHorizontalIcon}
                className={cn(isDefault(filters) ? "text-muted-foreground" : "text-primary")}
              />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{summary(filters)}</TooltipContent>
      </Tooltip>
      <PopoverContent align="start" className="w-64 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-partition`} className="text-xs">
            Partition
          </Label>
          <Select
            value={partition}
            onValueChange={(v) => onChange({ partition: v === ALL_PARTITIONS ? null : Number(v) })}
          >
            <SelectTrigger id={`${id}-partition`} size="sm" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_PARTITIONS}>All partitions</SelectItem>
              {partitions.map((p) => (
                <SelectItem key={p} value={String(p)}>
                  Partition {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-from`} className="text-xs">
            Start from
          </Label>
          <Select value={from} onValueChange={(v) => changeFrom(v as StartFrom)}>
            <SelectTrigger id={`${id}-from`} size="sm" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {START_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {from === "offset" && (
            <Input
              type="number"
              min={0}
              aria-label="Offset"
              className="h-8 font-mono text-xs md:text-xs"
              value={offset}
              onChange={(e) => typeValue(from, e.target.value, time)}
            />
          )}
          {from === "timestamp" && (
            <DateTimePicker label="Start" value={time} onChange={applyTime} className="h-8 w-full text-xs" />
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Highlights the trigger once reading no longer starts from the newest messages of every partition. */
function isDefault({ partition, from }: BrowseFilters): boolean {
  return partition == null && from === "latest";
}

/** e.g. "All partitions · Newest" or "Partition 2 · From offset 120". */
function summary({ partition, from, value }: BrowseFilters): string {
  const where = partition == null ? "All partitions" : `Partition ${partition}`;
  return `${where} · ${startLabel(from, value)}`;
}

function startLabel(from: StartFrom, value: number | null): string {
  switch (from) {
    case "latest":
      return "Newest";
    case "earliest":
      return "Oldest";
    case "offset":
      return `From offset ${value ?? 0}`;
    case "timestamp":
      return value == null ? "From time" : `From ${formatDateTime(value)}`;
  }
}

/** The request's `value` for a start option: an offset, epoch millis, or nothing. */
function startValue(from: StartFrom, offset: string, time: Date): number | null {
  if (from === "offset") return offset.trim() === "" ? Number.NaN : Number(offset);
  if (from === "timestamp") return time.getTime();
  return null;
}

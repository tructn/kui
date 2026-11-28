import { useEffect, useRef, useState } from "react";

import { DateTimePicker } from "@/components/date-time-picker";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import type { BrowseFilters, StartFrom } from "../types";

const ALL_PARTITIONS = "all";
/** How long changes to the offset / time wait for the user to pause before they apply. */
const TYPING_DELAY_MS = 400;

/** Compact dropdown that sits inside the query bar's frame. */
const CHIP =
  "h-6 gap-1 rounded-md border-transparent bg-muted/70 py-0 pr-1.5 pl-2 text-xs hover:bg-muted data-[size=sm]:h-6 data-[size=sm]:rounded-md dark:bg-muted/70 dark:hover:bg-muted [&_svg]:size-3.5";

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

/** Toolbar that edits the `BrowseFilters`. Dropdowns apply at once, typed values after a short pause. */
export function MessageFilters({ partitions, filters, onChange, disabled }: MessageFiltersProps) {
  const [offset, setOffset] = useState("0");
  const [time, setTime] = useState(() => new Date(Date.now() - 60 * 60 * 1000));
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
    <div className="flex shrink-0 items-center gap-1">
      <fieldset disabled={disabled} className="contents">
        <Select
          value={partition}
          onValueChange={(v) => onChange({ partition: v === ALL_PARTITIONS ? null : Number(v) })}
        >
          <SelectTrigger size="sm" className={CHIP} aria-label="Partition">
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

        <Select value={from} onValueChange={(v) => changeFrom(v as StartFrom)}>
          <SelectTrigger size="sm" className={CHIP} aria-label="Start from">
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
            className="h-6 w-24 rounded-md px-2 font-mono text-xs md:text-xs"
            value={offset}
            onChange={(e) => typeValue(from, e.target.value, time)}
          />
        )}
        {from === "timestamp" && (
          <DateTimePicker
            label="Start"
            value={time}
            onChange={applyTime}
            className="h-6 w-auto gap-2 rounded-md px-2 text-xs"
          />
        )}
      </fieldset>
    </div>
  );
}

/** The request's `value` for a start option: an offset, epoch millis, or nothing. */
function startValue(from: StartFrom, offset: string, time: Date): number | null {
  if (from === "offset") return offset.trim() === "" ? Number.NaN : Number(offset);
  if (from === "timestamp") return time.getTime();
  return null;
}

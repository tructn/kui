import { Calendar03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

interface DateTimePickerProps {
  value: Date;
  onChange: (value: Date) => void;
  /** Names the field for screen readers, e.g. "Start". */
  label: string;
  className?: string;
}

/**
 * One field for a UTC date and time (to the second): the button shows both, and
 * its popover holds the calendar with the time underneath. Picks are a draft
 * until Done (or Enter in the time field) applies them; Esc or a click outside
 * closes it without changing anything.
 *
 * Keyboard: Enter opens it with focus on the calendar (arrow keys move between
 * days, Enter picks one), Tab moves on to the time field and Done.
 */
export function DateTimePicker({ value, onChange, label, className }: DateTimePickerProps) {
  const [open, setOpen] = useState(false);
  const timeId = useId();
  const [draft, setDraft] = useState(value);
  // The time field is edited segment by segment, and is empty while half typed,
  // so it keeps its own text and only updates the draft with complete times.
  const [time, setTime] = useState(() => utcTime(value));

  /** Opening starts a fresh draft from the applied value; closing discards it. */
  function toggle(next: boolean) {
    if (next) {
      setDraft(value);
      setTime(utcTime(value));
    }
    setOpen(next);
  }

  function pickDay(day: Date | undefined) {
    if (!day) return;
    // The calendar runs in UTC, so the picked day's UTC fields are the day the user clicked.
    const next = new Date(draft);
    next.setUTCFullYear(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
    setDraft(next);
  }

  function typeTime(text: string) {
    setTime(text);
    const [hours, minutes, seconds = 0] = text.split(":").map(Number);
    if (text === "" || [hours, minutes, seconds].some(Number.isNaN)) return;
    const next = new Date(draft);
    next.setUTCHours(hours, minutes, seconds, 0);
    setDraft(next);
  }

  function apply() {
    if (draft.getTime() !== value.getTime()) onChange(draft);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={toggle}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn("w-56 justify-between font-normal", className)}
          aria-label={`${label}: ${formatDateTime(value.getTime())}`}
        >
          <span className="tabular-nums">{formatDateTime(value.getTime())}</span>
          <HugeiconsIcon icon={Calendar03Icon} className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto overflow-hidden p-0" align="start" aria-label={label}>
        <Calendar
          mode="single"
          selected={draft}
          defaultMonth={draft}
          captionLayout="dropdown"
          timeZone="UTC"
          onSelect={pickDay}
          autoFocus
        />
        <form
          className="flex items-end gap-2 border-t p-3"
          onSubmit={(e) => {
            e.preventDefault();
            apply();
          }}
        >
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor={timeId} className="text-xs text-muted-foreground">
              Time (UTC)
            </Label>
            <Input
              id={timeId}
              type="time"
              step={1}
              value={time}
              onChange={(e) => typeTime(e.target.value)}
              className="appearance-none bg-background font-mono [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none"
            />
          </div>
          <Button type="submit">Done</Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

function utcTime(date: Date): string {
  return date.toISOString().slice(11, 19);
}

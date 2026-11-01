import { format } from "date-fns";
import { CalendarClockIcon } from "lucide-react";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface DateTimePickerProps {
  value: Date;
  onChange: (value: Date) => void;
  /** Names the field for screen readers, e.g. "Start". */
  label: string;
}

/**
 * One field for a date and a time (to the second): the button shows both, and
 * its popover holds the calendar with the time underneath. Picks are a draft
 * until Done (or Enter in the time field) applies them; Esc or a click outside
 * closes it without changing anything.
 *
 * Keyboard: Enter opens it with focus on the calendar (arrow keys move between
 * days, Enter picks one), Tab moves on to the time field and Done.
 */
export function DateTimePicker({ value, onChange, label }: DateTimePickerProps) {
  const [open, setOpen] = useState(false);
  const timeId = useId();
  const [draft, setDraft] = useState(value);
  // The time field is edited segment by segment, and is empty while half typed,
  // so it keeps its own text and only updates the draft with complete times.
  const [time, setTime] = useState(() => format(value, "HH:mm:ss"));

  /** Opening starts a fresh draft from the applied value; closing discards it. */
  function toggle(next: boolean) {
    if (next) {
      setDraft(value);
      setTime(format(value, "HH:mm:ss"));
    }
    setOpen(next);
  }

  function pickDay(day: Date | undefined) {
    if (!day) return;
    const next = new Date(day);
    next.setHours(draft.getHours(), draft.getMinutes(), draft.getSeconds(), 0);
    setDraft(next);
  }

  function typeTime(text: string) {
    setTime(text);
    const [hours, minutes, seconds = 0] = text.split(":").map(Number);
    if (text === "" || [hours, minutes, seconds].some(Number.isNaN)) return;
    const next = new Date(draft);
    next.setHours(hours, minutes, seconds, 0);
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
          className="w-56 justify-between font-normal"
          aria-label={`${label}: ${format(value, "PPP 'at' HH:mm:ss")}`}
        >
          <span className="tabular-nums">{format(value, "MMM d, yyyy · HH:mm:ss")}</span>
          <CalendarClockIcon className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto overflow-hidden p-0" align="start" aria-label={label}>
        <Calendar
          mode="single"
          selected={draft}
          defaultMonth={draft}
          captionLayout="dropdown"
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
              Time
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

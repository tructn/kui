import { FilterIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Command, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { isFilterActive, type ColumnFilter } from "@/lib/column-filter";
import { cn } from "@/lib/utils";

export interface FilterOption {
  value: string;
  label: string;
}

interface ColumnFilterButtonProps {
  /** The column's name, for the button's accessible name: "Filter status". */
  label: string;
  filter: ColumnFilter | undefined;
  onChange: (filter: ColumnFilter | null) => void;
  /** Pick from these values; without them the filter is a "contains" text box. */
  options?: readonly FilterOption[];
}

/** A funnel in a column header that opens the column's filter. Sits in a `TableHead`, or a sortable one's `info`. */
export function ColumnFilterButton({ label, filter, onChange, options }: ColumnFilterButtonProps) {
  const [open, setOpen] = useState(false);
  const active = isFilterActive(filter);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Filter ${label.toLowerCase()}${active ? " (on)" : ""}`}
          aria-pressed={active}
          className={cn("size-6", active ? "text-primary" : "text-muted-foreground opacity-60 hover:opacity-100")}
        >
          <HugeiconsIcon icon={FilterIcon} className="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-0" aria-label={`Filter ${label.toLowerCase()}`}>
        {options ? (
          <OptionsFilter options={options} filter={filter} onChange={onChange} />
        ) : (
          <TextFilter label={label} filter={filter} onChange={onChange} onDone={() => setOpen(false)} />
        )}
        {active && (
          <div className="border-t p-1">
            <Button type="button" variant="ghost" size="sm" className="w-full justify-center" onClick={() => onChange(null)}>
              Clear filter
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function TextFilter({
  label,
  filter,
  onChange,
  onDone,
}: {
  label: string;
  filter: ColumnFilter | undefined;
  onChange: (filter: ColumnFilter | null) => void;
  onDone: () => void;
}) {
  const text = filter?.kind === "text" ? filter.text : "";
  return (
    <form
      className="p-2"
      onSubmit={(e) => {
        e.preventDefault();
        onDone();
      }}
    >
      <Input
        autoFocus
        className="h-8"
        placeholder={`${label} contains…`}
        aria-label={`${label} contains`}
        value={text}
        onChange={(e) => onChange(e.target.value ? { kind: "text", text: e.target.value } : null)}
      />
    </form>
  );
}

function OptionsFilter({
  options,
  filter,
  onChange,
}: {
  options: readonly FilterOption[];
  filter: ColumnFilter | undefined;
  onChange: (filter: ColumnFilter | null) => void;
}) {
  const picked = filter?.kind === "options" ? filter.values : [];
  function toggle(value: string) {
    const values = picked.includes(value) ? picked.filter((v) => v !== value) : [...picked, value];
    onChange(values.length > 0 ? { kind: "options", values } : null);
  }
  return (
    <Command>
      <CommandList>
        {options.length === 0 && <p className="px-3 py-2 text-xs text-muted-foreground">No values yet.</p>}
        <CommandGroup>
          {options.map((option) => (
            <CommandItem
              key={option.value}
              value={option.value}
              aria-checked={picked.includes(option.value)}
              onSelect={() => toggle(option.value)}
            >
              <Checkbox checked={picked.includes(option.value)} aria-hidden tabIndex={-1} className="pointer-events-none" />
              <span className="truncate">{option.label}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  );
}

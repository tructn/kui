import { UnfoldMoreIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { matchByName } from "@/lib/name-search";
import { cn } from "@/lib/utils";

/** Rendering every topic of a large cluster would stall the popover; searching narrows it down. */
const MAX_SHOWN = 200;

interface SearchableSelectProps {
  id?: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
  placeholder: string;
  /** Names the search box for screen readers, e.g. "Search topics". */
  searchLabel: string;
  emptyText: string;
  invalid?: boolean;
  className?: string;
}

/** A select whose options are filtered by typing, for lists too long to scroll through. */
export function SearchableSelect({
  id,
  value,
  options,
  onChange,
  placeholder,
  searchLabel,
  emptyText,
  invalid,
  className,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const named = useMemo(() => options.map((name) => ({ name })), [options]);
  const matches = matchByName(named, query);
  const shown = matches.slice(0, MAX_SHOWN);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-invalid={invalid}
          title={value || undefined}
          className={cn("w-full min-w-0 justify-between px-2.5 font-normal", className)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
            }
          }}
        >
          <span className={cn("truncate", !value && "text-muted-foreground")}>{value || placeholder}</span>
          <HugeiconsIcon icon={UnfoldMoreIcon} className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--radix-popover-trigger-width) min-w-64 p-0">
        {/* Filtering is done above, so cmdk only handles keyboard focus. */}
        <Command shouldFilter={false}>
          <CommandInput placeholder={`${searchLabel}…`} aria-label={searchLabel} value={query} onValueChange={setQuery} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            {shown.length > 0 && (
              <CommandGroup>
                {shown.map(({ name }) => (
                  <CommandItem
                    key={name}
                    value={name}
                    data-checked={name === value}
                    className={className}
                    onSelect={() => {
                      onChange(name);
                      setOpen(false);
                    }}
                  >
                    <span className="min-w-0 flex-1 truncate">{name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {matches.length > shown.length && (
              <p className="px-3 py-2 text-xs text-muted-foreground">
                Showing {shown.length} of {matches.length}. Type to narrow down.
              </p>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

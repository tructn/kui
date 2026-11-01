import { ChevronsUpDownIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatNumber } from "@/lib/format";
import { matchByName } from "@/lib/name-search";

import type { CopyTarget } from "../types";

/** Rendering every match makes typing sluggish on clusters with thousands of topics. */
const MAX_SHOWN = 100;

interface TopicPickerProps {
  id?: string;
  value: string;
  options: CopyTarget[];
  /** Labelled "(this topic)" in the list. */
  currentTopic: string;
  onChange: (topic: string) => void;
}

/** Topic select with a search box: type part of a name to narrow the list. */
export function TopicPicker({ id, value, options, currentTopic, onChange }: TopicPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const matches = useMemo(() => matchByName(options, query), [options, query]);
  const shown = matches.slice(0, MAX_SHOWN);

  function choose(topic: string) {
    onChange(topic);
    setOpen(false);
  }

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
          title={value}
          className="w-full min-w-0 justify-between px-2.5 font-mono font-normal"
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
            }
          }}
        >
          <span className="truncate">{value}</span>
          <ChevronsUpDownIcon className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-(--radix-popover-trigger-width) max-w-[min(32rem,calc(100vw-2rem))] min-w-96 p-0"
      >
        {/* Filtering is done above, so cmdk only handles keyboard focus. */}
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search topics…"
            aria-label="Search topics"
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandEmpty>No matching topics.</CommandEmpty>
            {shown.map((t) => (
              <CommandItem
                key={t.name}
                value={t.name}
                onSelect={choose}
                data-checked={t.name === value}
                className="font-mono"
              >
                <span className="min-w-0 [overflow-wrap:anywhere]">{t.name}</span>
                {t.name === currentTopic && (
                  <span className="shrink-0 font-sans whitespace-nowrap text-muted-foreground">(this topic)</span>
                )}
              </CommandItem>
            ))}
            {matches.length > shown.length && (
              <p className="px-2 py-1.5 text-xs text-muted-foreground">
                {formatNumber(matches.length - shown.length)} more. Type more of the name to narrow the list.
              </p>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

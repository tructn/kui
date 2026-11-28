import { PlusSignIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

import { useGenerators } from "../queries";

/** Searchable list of every `{{placeholder}}`; choosing one inserts it at the cursor. */
export function PlaceholderPicker({ onInsert }: { onInsert: (snippet: string) => void }) {
  const [open, setOpen] = useState(false);
  const generators = useGenerators();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" size="sm" variant="outline">
          <HugeiconsIcon icon={PlusSignIcon} /> Placeholder
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <Command>
          <CommandInput placeholder="Search placeholders…" aria-label="Search placeholders" />
          <CommandList className="max-h-80">
            <CommandEmpty>No matching placeholders.</CommandEmpty>
            {generators.data?.map((g) => {
              const snippet = g.example.split(" / ")[0];
              return (
                <CommandItem
                  key={g.name}
                  value={`${g.name} ${g.description}`}
                  title={g.example}
                  onSelect={() => {
                    setOpen(false);
                    onInsert(snippet);
                  }}
                  className="flex flex-col items-start gap-0.5"
                >
                  <code className="text-xs">{snippet}</code>
                  <span className="text-xs text-muted-foreground">{g.description}</span>
                </CommandItem>
              );
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

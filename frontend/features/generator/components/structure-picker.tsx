import { BracketsIcon, CodeIcon, TextIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";

import { cn } from "@/lib/utils";

import type { Structure } from "../infer";

interface StructurePickerProps {
  structures: Structure[];
  /** Messages the structures were learned from. */
  sampled: number;
  /** Id of the structure the template still matches; null once edited or another scenario is picked. */
  active: string | null;
  onPick: (structure: Structure) => void;
}

const ICONS: Record<Structure["kind"], IconSvgElement> = {
  object: CodeIcon,
  array: BracketsIcon,
  value: CodeIcon,
  text: TextIcon,
};

/** The message shapes found on the loaded page of the topic, most common first. */
export function StructurePicker({ structures, sampled, active, onPick }: StructurePickerProps) {
  return (
    <div role="group" aria-label="Topic structure" className="flex flex-col gap-1.5">
      <span className="text-xs text-muted-foreground">
        {structures.length === 1
          ? `Matches the ${sampled} loaded ${sampled === 1 ? "message" : "messages"}`
          : `${structures.length} shapes in the ${sampled} loaded messages`}
      </span>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {structures.map((structure) => {
          const selected = structure.id === active;
          return (
            <button
              key={structure.id}
              type="button"
              aria-pressed={selected}
              onClick={() => onPick(structure)}
              className={cn(
                "flex min-w-0 items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors outline-none",
                "hover:bg-accent focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
                selected && "border-primary bg-primary/5 text-foreground hover:bg-primary/10",
              )}
            >
              <HugeiconsIcon
                icon={ICONS[structure.kind]}
                className={cn("size-4 shrink-0", selected ? "text-primary" : "text-muted-foreground")}
              />
              <span className="min-w-0 flex-1 truncate font-mono text-xs">{describe(structure)}</span>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {Math.round((structure.count / sampled) * 100)}%
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function describe(structure: Structure): string {
  switch (structure.kind) {
    case "object":
      return structure.fields.length === 0 ? "{ }" : `{ ${structure.fields.join(", ")} }`;
    case "array":
      return "JSON array";
    case "value":
      return "JSON value";
    case "text":
      return "Plain text";
  }
}

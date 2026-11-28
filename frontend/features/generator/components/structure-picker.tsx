import { ArrowDown01Icon, Database01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatNumber } from "@/lib/format";

import type { Structure } from "../infer";
import { TemplateChip } from "./template-chip";

interface StructurePickerProps {
  structures: Structure[];
  /** Messages the structures were learned from. */
  sampled: number;
  /** Id of the structure the template still matches; null once edited or another scenario is picked. */
  active: string | null;
  onPick: (structure: Structure) => void;
}

/** Fields listed per shape; a wide topic would otherwise fill the screen. */
const MAX_SHAPE_FIELDS = 12;

/**
 * The message shapes ("envelopes") found on the loaded page of the topic. One shape is a single chip; several
 * collapse into a dropdown so they don't stretch the chip row.
 */
export function StructurePicker({ structures, sampled, active, onPick }: StructurePickerProps) {
  const [first] = structures;
  if (first === undefined) return null;
  return (
    <div role="group" aria-label="Topic structure" className="flex shrink-0 items-center">
      {structures.length === 1 ? (
        <SingleEnvelope structure={first} sampled={sampled} selected={first.id === active} onPick={onPick} />
      ) : (
        <EnvelopeMenu structures={structures} sampled={sampled} active={active} onPick={onPick} />
      )}
    </div>
  );
}

function SingleEnvelope({
  structure,
  sampled,
  selected,
  onPick,
}: {
  structure: Structure;
  sampled: number;
  selected: boolean;
  onPick: (structure: Structure) => void;
}) {
  const shape = describe(structure);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <TemplateChip selected={selected} onClick={() => onPick(structure)}>
          <HugeiconsIcon icon={Database01Icon} />
          Envelope
          {/* The tooltip only mounts on hover, so screen readers get the shape here. */}
          <span className="sr-only">{shape}</span>
        </TemplateChip>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="flex max-w-xs flex-col gap-1">
        <span>
          Shape of {formatNumber(structure.count)} of {formatNumber(sampled)} loaded{" "}
          {sampled === 1 ? "message" : "messages"}
        </span>
        <span className="font-mono break-words opacity-80">{shape}</span>
      </TooltipContent>
    </Tooltip>
  );
}

function EnvelopeMenu({ structures, sampled, active, onPick }: StructurePickerProps) {
  const activeIndex = structures.findIndex((s) => s.id === active);
  const shown = structures[activeIndex] ?? structures[0];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <TemplateChip selected={activeIndex >= 0}>
          <HugeiconsIcon icon={Database01Icon} />
          {activeIndex >= 0 ? `Envelope ${activeIndex + 1}` : "Envelope"}
          <span className="text-xs text-muted-foreground tabular-nums">{structures.length}</span>
          <HugeiconsIcon icon={ArrowDown01Icon} />
          {/* The menu only mounts when open, so screen readers get the current shape here. */}
          {shown && <span className="sr-only">{describe(shown)}</span>}
        </TemplateChip>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-80 max-w-[calc(100vw-2rem)]">
        <DropdownMenuLabel>
          Shapes in {formatNumber(sampled)} loaded {sampled === 1 ? "message" : "messages"}
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={active ?? ""}
          onValueChange={(id) => {
            const picked = structures.find((s) => s.id === id);
            if (picked) onPick(picked);
          }}
        >
          {structures.map((structure, i) => (
            <DropdownMenuRadioItem key={structure.id} value={structure.id} className="items-start">
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="flex items-center gap-2">
                  Envelope {i + 1}
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {Math.round((structure.count / sampled) * 100)}%
                  </span>
                </span>
                <span className="truncate font-mono text-xs text-muted-foreground">{describe(structure)}</span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function describe(structure: Structure): string {
  switch (structure.kind) {
    case "object": {
      if (structure.fields.length === 0) return "{ }";
      const shown = structure.fields.slice(0, MAX_SHAPE_FIELDS);
      const hidden = structure.fields.length - shown.length;
      return `{ ${shown.join(", ")}${hidden > 0 ? `, +${hidden} more` : ""} }`;
    }
    case "array":
      return "JSON array";
    case "value":
      return "JSON value";
    case "text":
      return "Plain text";
  }
}

import { HugeiconsIcon } from "@hugeicons/react";

import { cn } from "@/lib/utils";

import type { Preset } from "../presets";

interface PresetPickerProps {
  presets: Preset[];
  /** Null once the template has been edited away from every preset. */
  active: string | null;
  onPick: (preset: Preset) => void;
}

export function PresetPicker({ presets, active, onPick }: PresetPickerProps) {
  return (
    <div role="group" aria-label="Scenario" className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
      {presets.map((preset) => {
        const selected = preset.label === active;
        return (
          <button
            key={preset.label}
            type="button"
            aria-pressed={selected}
            onClick={() => onPick(preset)}
            className={cn(
              "flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors outline-none",
              "hover:bg-accent focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
              selected && "border-primary bg-primary/5 text-foreground hover:bg-primary/10",
            )}
          >
            <HugeiconsIcon
              icon={preset.icon}
              className={cn("size-4 shrink-0", selected ? "text-primary" : "text-muted-foreground")}
            />
            <span className="truncate">{preset.label}</span>
          </button>
        );
      })}
    </div>
  );
}

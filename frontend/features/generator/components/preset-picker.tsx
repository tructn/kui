import { HugeiconsIcon } from "@hugeicons/react";

import type { Preset } from "../presets";
import { TemplateChip } from "./template-chip";

interface PresetPickerProps {
  presets: Preset[];
  /** Null once the template has been edited away from every preset. */
  active: string | null;
  onPick: (preset: Preset) => void;
}

export function PresetPicker({ presets, active, onPick }: PresetPickerProps) {
  return (
    <div role="group" aria-label="Scenario" className="flex min-w-0 flex-wrap items-center gap-1.5">
      {presets.map((preset) => (
        <TemplateChip key={preset.label} selected={preset.label === active} onClick={() => onPick(preset)}>
          <HugeiconsIcon icon={preset.icon} />
          {preset.label}
        </TemplateChip>
      ))}
    </div>
  );
}

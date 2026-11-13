import { PipetteIcon } from "lucide-react";
import { HexColorInput, HexColorPicker } from "react-colorful";
import { useEffect, useRef, useState } from "react";
import { ToggleGroup } from "radix-ui";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ACCENTS, isCustomColor, type Accent } from "@/lib/accent";
import { cn } from "@/lib/utils";

const SWATCH =
  "flex size-5 items-center justify-center rounded-full ring-offset-2 ring-offset-background transition-shadow outline-none hover:ring-2 hover:ring-border";
// Styled on aria-checked: the Tooltip trigger overwrites data-state.
const SELECTED = "aria-checked:ring-2 aria-checked:ring-foreground/70";

/** How long the color picker must rest before the color is committed. */
const COMMIT_DELAY_MS = 150;
/** Where the picker starts when no custom color is set yet. */
const START_COLOR = "#f59e0b";
const RAINBOW = "bg-[conic-gradient(in_oklch_longer_hue,oklch(0.7_0.2_0),oklch(0.7_0.2_0))]";

interface AccentPickerProps {
  value: Accent;
  onChange: (value: Accent) => void;
}

/** A row of color swatches plus a custom color; the chosen one gets a ring. */
export function AccentPicker({ value, onChange }: AccentPickerProps) {
  const custom = isCustomColor(value) ? value : null;

  return (
    <div className="flex items-center gap-1.5">
      <ToggleGroup.Root
        type="single"
        aria-label="Accent color"
        value={custom ? "" : value}
        // Clicking the active swatch would deselect it (""); a choice is always set.
        onValueChange={(v) => v && onChange(v as Accent)}
        className="flex items-center gap-1.5"
      >
        {Object.entries(ACCENTS).map(([id, { label, swatch }]) => (
          <Swatch key={id} value={id} label={label} color={swatch} />
        ))}
      </ToggleGroup.Root>
      <CustomSwatch value={custom} onChange={onChange} />
    </div>
  );
}

function Swatch({ value, label, color }: { value: string; label: string; color: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <ToggleGroup.Item
          value={value}
          aria-label={label}
          style={{ backgroundColor: color }}
          className={cn(SWATCH, SELECTED, "focus-visible:ring-2 focus-visible:ring-ring/50")}
        />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * A swatch that opens an in-app color picker. (The webview's native
 * `<input type="color">` doesn't open anything on macOS.) Dragging updates the
 * swatch right away, but the color is only committed once it settles.
 */
function CustomSwatch({ value, onChange }: { value: string | null; onChange: (hex: `#${string}`) => void }) {
  const [draft, setDraft] = useState(value ?? START_COLOR);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => setDraft(value ?? START_COLOR), [value]);
  useEffect(() => () => clearTimeout(timer.current), []);

  function change(hex: string) {
    setDraft(hex);
    clearTimeout(timer.current);
    if (isCustomColor(hex)) timer.current = setTimeout(() => onChange(hex), COMMIT_DELAY_MS);
  }

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="Custom color"
              aria-checked={value !== null}
              role="switch"
              className={cn(SWATCH, SELECTED, "cursor-pointer focus-visible:ring-2 focus-visible:ring-ring/50", !value && RAINBOW)}
              style={value ? { backgroundColor: value } : undefined}
            >
              {!value && <PipetteIcon className="size-3 text-white drop-shadow" />}
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{value ? `Custom · ${value}` : "Custom color"}</TooltipContent>
      </Tooltip>
      <PopoverContent className="w-auto gap-3 p-3" align="end">
        <HexColorPicker color={draft} onChange={change} className="kui-color-picker" />
        <div className="flex items-center gap-2">
          <span className="size-6 shrink-0 rounded-md border" style={{ backgroundColor: draft }} />
          <HexColorInput
            prefixed
            aria-label="Hex color"
            color={draft}
            onChange={change}
            className="h-7 w-full min-w-0 rounded-md border border-input bg-transparent px-2 font-mono text-xs uppercase outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

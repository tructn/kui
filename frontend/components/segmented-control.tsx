import { ToggleGroup } from "radix-ui";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

// Styled on aria-checked, not data-state: a Tooltip trigger wrapping an item overwrites data-state.
export const SEGMENT_ITEM =
  "inline-flex h-7 items-center justify-center gap-1.5 rounded-md px-3 text-sm whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-checked:bg-background aria-checked:text-foreground aria-checked:shadow-sm dark:aria-checked:bg-input/50 [&_svg]:size-3.5";

export const SEGMENT_ROOT = "inline-flex rounded-lg bg-muted p-0.5";

export interface Segment<T extends string> {
  value: T;
  label: ReactNode;
  /** Shown under the control while this segment is selected. */
  description?: ReactNode;
}

interface SegmentedControlProps<T extends string> {
  label: string;
  segments: readonly Segment<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Stretch to the container, splitting it evenly between segments. */
  fill?: boolean;
  disabled?: boolean;
  className?: string;
}

/** A single choice among a few short options, drawn as one pill of segments. */
export function SegmentedControl<T extends string>({
  label,
  segments,
  value,
  onChange,
  fill = false,
  disabled,
  className,
}: SegmentedControlProps<T>) {
  const description = segments.find((s) => s.value === value)?.description;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <ToggleGroup.Root
        type="single"
        aria-label={label}
        value={value}
        disabled={disabled}
        // Clicking the active segment would deselect it (""); one is always chosen.
        onValueChange={(v) => v && onChange(v as T)}
        className={cn(SEGMENT_ROOT, fill && "flex w-full")}
      >
        {segments.map((s) => (
          <ToggleGroup.Item key={s.value} value={s.value} className={cn(SEGMENT_ITEM, fill && "flex-1")}>
            {s.label}
          </ToggleGroup.Item>
        ))}
      </ToggleGroup.Root>
      {description && <p className="text-xs text-muted-foreground">{description}</p>}
    </div>
  );
}

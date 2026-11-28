import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

interface TemplateChipProps extends ComponentProps<"button"> {
  selected: boolean;
}

/** A compact toggle that loads one template; topic shapes and scenarios share it so they sit in one row. */
export function TemplateChip({ selected, className, ...props }: TemplateChipProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm whitespace-nowrap transition-colors outline-none",
        "hover:bg-accent focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
        "[&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground",
        selected && "border-primary bg-primary/5 text-foreground hover:bg-primary/10 [&_svg]:text-primary",
        className,
      )}
      {...props}
    />
  );
}

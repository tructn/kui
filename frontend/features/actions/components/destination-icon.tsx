import { FunctionIcon, FunctionSquareIcon, GlobalIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";

import { cn } from "@/lib/utils";

import type { DestinationId } from "../destinations";

// Provider tints echo each cloud's console colours, so a card reads as AWS or Azure at a glance.
const ICONS: Record<DestinationId, { icon: IconSvgElement; tint: string }> = {
  localLambda: { icon: FunctionIcon, tint: "bg-orange-500/10 text-orange-600 dark:text-orange-400" },
  localAzureFunction: { icon: FunctionSquareIcon, tint: "bg-sky-500/10 text-sky-600 dark:text-sky-400" },
  http: { icon: GlobalIcon, tint: "bg-violet-500/10 text-violet-600 dark:text-violet-400" },
};

export function DestinationIcon({ id, size = "md", className }: { id: DestinationId; size?: "sm" | "md"; className?: string }) {
  const { icon: Icon, tint } = ICONS[id];
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center rounded-md",
        size === "md" ? "size-9 [&>svg]:size-5" : "size-6 [&>svg]:size-3.5",
        tint,
        className,
      )}
    >
      <HugeiconsIcon icon={Icon} />
    </span>
  );
}

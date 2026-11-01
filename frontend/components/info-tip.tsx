import { InfoIcon } from "lucide-react";
import type { ReactNode } from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** A small info icon that explains something on hover or focus. */
export function InfoTip({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className={cn(
            "inline-flex shrink-0 rounded-full text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
            className,
          )}
        >
          <InfoIcon className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent>{children}</TooltipContent>
    </Tooltip>
  );
}

/** A list of term → meaning, laid out for an `InfoTip`. */
export function InfoList({
  items,
}: {
  items: { term: ReactNode; description: string }[];
}) {
  return (
    <dl className="flex flex-col gap-1.5 py-0.5">
      {items.map(({ term, description }, i) => (
        <div key={i}>
          <dt className="font-medium">{term}</dt>
          <dd className="opacity-80">{description}</dd>
        </div>
      ))}
    </dl>
  );
}

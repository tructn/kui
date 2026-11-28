import { Copy01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/** Copies text to the clipboard; `copied` stays true for a moment after. */
export function useCopy() {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = (value: string) =>
    navigator.clipboard.writeText(value).then(
      () => setCopied(true),
      () => toast.error("Couldn't copy to the clipboard"),
    );

  return { copied, copy };
}

/** Copy icon that pops into a check mark once copied. */
export function CopyIndicator({ copied }: { copied: boolean }) {
  return copied ? (
    <HugeiconsIcon icon={Tick02Icon} className="animate-in duration-200 zoom-in-50 fade-in" />
  ) : (
    <HugeiconsIcon icon={Copy01Icon} />
  );
}

/** An icon button that copies `value` and briefly shows a check mark. */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const { copied, copy } = useCopy();

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={label}
          className="text-muted-foreground"
          onClick={() => copy(value)}
        >
          <CopyIndicator copied={copied} />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{copied ? "Copied" : label}</TooltipContent>
    </Tooltip>
  );
}

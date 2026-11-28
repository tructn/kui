import { Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useRef, type KeyboardEvent, type ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface Choice<T extends string> {
  value: T;
  title: ReactNode;
  description?: ReactNode;
  /** Extra content under the description, e.g. badges. */
  extra?: ReactNode;
  disabled?: boolean;
}

interface ChoiceCardsProps<T extends string> {
  label: string;
  choices: Choice<T>[];
  value: T | null;
  onChange: (value: T) => void;
  columns?: 1 | 2;
  disabled?: boolean;
}

/**
 * A radio group drawn as cards. Arrow keys move the selection, as in a
 * native radio group, and only the selected card is in the Tab order.
 */
export function ChoiceCards<T extends string>({
  label,
  choices,
  value,
  onChange,
  columns = 2,
  disabled,
}: ChoiceCardsProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const selected = choices.findIndex((c) => c.value === value);
  const focusable = selected === -1 ? Math.max(0, choices.findIndex((c) => !c.disabled)) : selected;

  function onKeyDown(event: KeyboardEvent, index: number) {
    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    let next = index;
    do next = (next + step + choices.length) % choices.length;
    while (choices[next].disabled && next !== index);
    if (next === index) return;
    onChange(choices[next].value);
    refs.current[next]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn("grid gap-2", columns === 2 && "sm:grid-cols-2")}
    >
      {choices.map((choice, i) => {
        const checked = choice.value === value;
        return (
          <button
            key={choice.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={i === focusable ? 0 : -1}
            disabled={disabled || choice.disabled}
            onClick={() => onChange(choice.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              "relative flex min-w-0 flex-col items-start gap-1 rounded-lg border p-3 text-left text-sm outline-none transition-colors",
              "hover:bg-muted/50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
              checked && "border-primary/40 bg-primary/5 dark:bg-primary/10",
            )}
          >
            <span className="flex w-full items-center gap-2 pr-6 font-medium">{choice.title}</span>
            {choice.description && <span className="text-xs text-muted-foreground">{choice.description}</span>}
            {choice.extra}
            {checked && (
              <HugeiconsIcon
                icon={Tick02Icon}
                className="absolute top-3 right-3 size-4 text-primary"
                aria-hidden
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

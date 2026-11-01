import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";

/** ⌘ on macOS, Ctrl elsewhere: how the `mod+` key of `useShortcut` is shown. */
export const MOD_KEY = navigator.userAgent.includes("Mac") ? "⌘" : "Ctrl";

/** Shows a key combo, e.g. `<ShortcutHint keys={[MOD_KEY, "K"]} />`. Hidden from screen readers, which get `aria-keyshortcuts`. */
export function ShortcutHint({ keys, className }: { keys: string[]; className?: string }) {
  return (
    <KbdGroup aria-hidden className={cn("shrink-0", className)}>
      {keys.map((key) => (
        <Kbd key={key}>{key}</Kbd>
      ))}
    </KbdGroup>
  );
}

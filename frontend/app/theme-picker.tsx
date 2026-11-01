import { MonitorIcon, MoonIcon, SunIcon, type LucideIcon } from "lucide-react";
import { ToggleGroup } from "radix-ui";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenuButton } from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { useTheme, type Theme } from "./stores/theme-store";

const THEMES: { value: Theme; label: string; icon: LucideIcon }[] = [
  { value: "system", label: "System", icon: MonitorIcon },
  { value: "light", label: "Light", icon: SunIcon },
  { value: "dark", label: "Dark", icon: MoonIcon },
];

// Styled on aria-checked, not data-state: a Tooltip trigger wrapping an item overwrites data-state.
const ITEM =
  "inline-flex h-7 items-center justify-center gap-1.5 rounded-md px-3 text-sm text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-checked:bg-background aria-checked:text-foreground aria-checked:shadow-sm dark:aria-checked:bg-input/50 [&_svg]:size-3.5";

/**
 * System / Light / Dark segmented control. `iconOnly` drops the labels into
 * tooltips, for tight spots like the sidebar.
 */
export function ThemePicker({ iconOnly = false, className }: { iconOnly?: boolean; className?: string }) {
  const theme = useTheme((s) => s.theme);
  const setTheme = useTheme((s) => s.setTheme);

  return (
    <ToggleGroup.Root
      type="single"
      aria-label="Theme"
      value={theme}
      // Clicking the active option would deselect it (""); a theme is always set.
      onValueChange={(v) => v && setTheme(v as Theme)}
      className={cn("inline-flex rounded-lg bg-muted p-0.5", className)}
    >
      {THEMES.map(({ value, label, icon: Icon }) =>
        iconOnly ? (
          <Tooltip key={value}>
            <TooltipTrigger asChild>
              <ToggleGroup.Item value={value} aria-label={label} className={cn(ITEM, "flex-1 px-0")}>
                <Icon />
              </ToggleGroup.Item>
            </TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
          </Tooltip>
        ) : (
          <ToggleGroup.Item key={value} value={value} aria-label={label} className={ITEM}>
            <Icon /> {label}
          </ToggleGroup.Item>
        ),
      )}
    </ToggleGroup.Root>
  );
}

/**
 * One icon button showing the current theme, which opens a menu of all three.
 * For the collapsed sidebar, where three segments would be too small to hit.
 */
export function ThemeMenuButton() {
  const theme = useTheme((s) => s.theme);
  const setTheme = useTheme((s) => s.setTheme);
  const current = THEMES.find((t) => t.value === theme) ?? THEMES[0];

  return (
    <DropdownMenu>
      {/* Tooltip outside the menu trigger: each layer passes its props down to the button. */}
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton aria-label={`Theme: ${current.label}`}>
              <current.icon />
              <span>Theme</span>
            </SidebarMenuButton>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="right">Theme: {current.label}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent side="right" align="end" className="min-w-36">
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as Theme)}>
          {THEMES.map(({ value, label, icon: Icon }) => (
            <DropdownMenuRadioItem key={value} value={value}>
              <Icon /> {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

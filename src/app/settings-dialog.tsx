import { getVersion } from "@tauri-apps/api/app";
import {
  DownloadIcon,
  KeyboardIcon,
  MonitorIcon,
  MoonIcon,
  PaletteIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  SlidersHorizontalIcon,
  SunIcon,
  type LucideIcon,
} from "lucide-react";
import { ToggleGroup } from "radix-ui";
import { useEffect, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldContent, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import {
  CODE_FONT_SIZES,
  CODE_FONTS,
  UI_FONTS,
  useAppearance,
  type CodeFont,
  type UiFont,
} from "./stores/appearance-store";
import { MOD_KEY, ShortcutHint } from "@/components/shortcut-hint";
import { useShortcut } from "@/hooks/use-shortcut";

import { useSettingsDialog } from "./stores/settings-dialog-store";
import { useTheme, type Theme } from "./stores/theme-store";
import { useUpdates } from "./stores/update-store";
import { useViewStateStore } from "./stores/view-state-store";

interface Section {
  id: string;
  label: string;
  icon: LucideIcon;
  description: string;
  content: () => ReactNode;
}

const SECTIONS: Section[] = [
  {
    id: "general",
    label: "General",
    icon: SlidersHorizontalIcon,
    description: "How KUI behaves as you move around it.",
    content: () => <GeneralSettings />,
  },
  {
    id: "appearance",
    label: "Appearance",
    icon: PaletteIcon,
    description: "Applies right away and is remembered on this machine.",
    content: () => <AppearanceSettings />,
  },
  {
    id: "updates",
    label: "Updates",
    icon: DownloadIcon,
    description: "Which versions KUI offers to install, and when it looks for them.",
    content: () => <UpdateSettings />,
  },
  {
    id: "shortcuts",
    label: "Shortcuts",
    icon: KeyboardIcon,
    description: "Move around KUI without the mouse.",
    content: () => <KeyboardShortcuts />,
  },
];

/** The app's one Settings dialog. Open it from anywhere with `useSettingsDialog().show()`, or ⌘,. */
export function SettingsDialog() {
  const { open, setOpen } = useSettingsDialog();
  const show = useSettingsDialog((s) => s.show);
  // ⌘, is the macOS convention for preferences.
  useShortcut("mod+,", show);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {/* Fixed height, one section at a time: switching sections doesn't make the dialog jump. */}
      <DialogContent className="flex h-[min(34rem,85vh)] gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <Tabs orientation="vertical" defaultValue={SECTIONS[0].id} className="min-h-0 min-w-0 flex-1 gap-0">
          <div className="flex w-48 shrink-0 flex-col gap-3 border-r bg-muted/40 p-3">
            <DialogTitle className="px-2 pt-1.5 text-base">Settings</DialogTitle>
            <DialogDescription className="sr-only">General behavior, appearance, updates and keyboard shortcuts.</DialogDescription>
            <TabsList className="w-full items-stretch gap-0.5 bg-transparent p-0">
              {SECTIONS.map(({ id, label, icon: Icon }) => (
                <TabsTrigger key={id} value={id} className="h-8 flex-none px-2 font-normal data-active:font-medium">
                  <Icon /> {label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          {SECTIONS.map((section) => (
            <TabsContent key={section.id} value={section.id} className="min-h-0 min-w-0 overflow-y-auto px-6 pt-5 pb-6">
              <header className="mb-5 pr-8">
                <h2 className="text-base font-semibold">{section.label}</h2>
                <p className="text-sm text-muted-foreground">{section.description}</p>
              </header>
              {section.content()}
            </TabsContent>
          ))}
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function GeneralSettings() {
  const remember = useViewStateStore((s) => s.remember);
  const setRemember = useViewStateStore((s) => s.setRemember);

  return (
    <SettingsGroup>
      <SettingRow
        label="Remember sorting and filters"
        description="Keep sorting, search, and filters when you switch pages or restart KUI."
        htmlFor="remember-view-state"
      >
        <Switch id="remember-view-state" checked={remember} onCheckedChange={setRemember} />
      </SettingRow>
    </SettingsGroup>
  );
}

const THEMES: { value: Theme; label: string; icon: LucideIcon }[] = [
  { value: "system", label: "System", icon: MonitorIcon },
  { value: "light", label: "Light", icon: SunIcon },
  { value: "dark", label: "Dark", icon: MoonIcon },
];

function AppearanceSettings() {
  const theme = useTheme((s) => s.theme);
  const setTheme = useTheme((s) => s.setTheme);
  const { uiFont, codeFont, codeFontSize, codeLigatures, update, reset } = useAppearance();

  return (
    <div className="flex flex-col gap-6">
      <SettingsGroup>
        <SettingRow label="Theme">
          <ToggleGroup.Root
            type="single"
            aria-label="Theme"
            value={theme}
            // Clicking the active option would deselect it (""); a theme is always set.
            onValueChange={(v) => v && setTheme(v as Theme)}
            className="inline-flex rounded-lg bg-muted p-0.5"
          >
            {THEMES.map(({ value, label, icon: Icon }) => (
              <ToggleGroup.Item
                key={value}
                value={value}
                className="inline-flex h-7 items-center gap-1.5 rounded-md px-3 text-sm text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm dark:data-[state=on]:bg-input/50 [&_svg]:size-3.5"
              >
                <Icon /> {label}
              </ToggleGroup.Item>
            ))}
          </ToggleGroup.Root>
        </SettingRow>
      </SettingsGroup>

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h3 className="px-1 text-xs font-medium text-muted-foreground">Fonts</h3>
          <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={reset}>
            <RotateCcwIcon /> Reset
          </Button>
        </div>
        <SettingsGroup>
          <SettingRow label="Interface font">
            <Select value={uiFont} onValueChange={(v) => update({ uiFont: v as UiFont })}>
              <SelectTrigger size="sm" className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(UI_FONTS).map(([id, font]) => (
                  <SelectItem key={id} value={id} style={{ fontFamily: font.stack }}>
                    {font.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingRow>

          <SettingRow label="Code font">
            <Select value={codeFont} onValueChange={(v) => update({ codeFont: v as CodeFont })}>
              <SelectTrigger size="sm" className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(CODE_FONTS).map(([id, font]) => (
                  <SelectItem key={id} value={id} style={{ fontFamily: font.stack }}>
                    {font.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingRow>

          <SettingRow label="Editor font size">
            <Select value={String(codeFontSize)} onValueChange={(v) => update({ codeFontSize: Number(v) })}>
              <SelectTrigger size="sm" className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CODE_FONT_SIZES.map((size) => (
                  <SelectItem key={size} value={String(size)}>
                    {size}px
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingRow>

          <SettingRow label="Code ligatures" htmlFor="code-ligatures">
            <Switch
              id="code-ligatures"
              checked={codeLigatures}
              onCheckedChange={(checked) => update({ codeLigatures: checked })}
            />
          </SettingRow>

          <pre className="bg-muted/40 whitespace-pre-wrap px-4 py-3 font-mono text-[length:var(--app-code-size)] leading-relaxed">
            {`{ "orderId": "o-1001", "total": 129.90, "status": "PAID" } // => 0O1lI`}
          </pre>
        </SettingsGroup>
      </section>
    </div>
  );
}

type CheckState = { step: "idle" } | { step: "checking" } | { step: "done"; message: string; failed?: boolean };

function UpdateSettings() {
  const { checkAutomatically, includeReleaseCandidates, setPrefs, check, setDialogOpen } = useUpdates();
  const [version, setVersion] = useState<string>();
  const [state, setState] = useState<CheckState>({ step: "idle" });

  useEffect(() => {
    getVersion().then(setVersion, () => undefined);
  }, []);

  async function checkNow() {
    setState({ step: "checking" });
    try {
      const available = await check();
      if (available) {
        setState({ step: "idle" });
        setDialogOpen(true);
      } else {
        setState({ step: "done", message: "You have the latest version." });
      }
    } catch (error) {
      setState({ step: "done", message: `Could not check: ${(error as Error).message}`, failed: true });
    }
  }

  return (
    <SettingsGroup>
      <SettingRow
        label={`KUI ${version ?? ""}`}
        description={
          state.step === "done" ? (
            <span className={state.failed ? "text-destructive" : undefined}>{state.message}</span>
          ) : (
            "The version you're running."
          )
        }
      >
        <Button variant="outline" size="sm" disabled={state.step === "checking"} onClick={checkNow}>
          {state.step === "checking" ? <Spinner /> : <RefreshCwIcon />} Check now
        </Button>
      </SettingRow>

      <SettingRow
        label="Check for updates automatically"
        description="At startup and every few hours while KUI is open."
        htmlFor="check-updates"
      >
        <Switch
          id="check-updates"
          checked={checkAutomatically}
          onCheckedChange={(checked) => setPrefs({ checkAutomatically: checked })}
        />
      </SettingRow>

      <SettingRow
        label="Include release candidates"
        description="Get versions such as 0.3.0-rc.1 before their release, to try new features early. They may have bugs."
        htmlFor="release-candidates"
      >
        <Switch
          id="release-candidates"
          checked={includeReleaseCandidates}
          onCheckedChange={(checked) => {
            setPrefs({ includeReleaseCandidates: checked });
            setState({ step: "idle" });
          }}
        />
      </SettingRow>
    </SettingsGroup>
  );
}

const SHORTCUTS: [keys: string[], action: string][] = [
  [[MOD_KEY, "K"], "Search topics"],
  [[MOD_KEY, "1 – 3"], "Go to Topics, Consumer groups, Brokers"],
  [[MOD_KEY, ","], "Open Settings"],
  [["↑", "↓"], "Move between table rows (also k / j)"],
  [["Home", "End"], "First / last row"],
  [["Enter"], "Open the focused row"],
  [["["], "Previous page"],
  [["]"], "Next page"],
  [["L"], "Toggle live mode on a topic's messages"],
  [["Esc"], "Close a dialog or panel"],
];

function KeyboardShortcuts() {
  return (
    <SettingsGroup>
      <dl className="divide-y">
        {SHORTCUTS.map(([keys, action]) => (
          <div key={action} className="flex items-center justify-between gap-4 px-4 py-2 text-sm">
            <dt>{action}</dt>
            <dd>
              <ShortcutHint keys={keys} />
              <span className="sr-only">{keys.join(" + ")}</span>
            </dd>
          </div>
        ))}
      </dl>
    </SettingsGroup>
  );
}

/** Rows on one card, split by hairlines, like the grouped lists of macOS System Settings. */
function SettingsGroup({ children }: { children: ReactNode }) {
  return <div className="divide-y overflow-hidden rounded-lg border bg-card">{children}</div>;
}

function SettingRow({
  label,
  description,
  htmlFor,
  children,
}: {
  label: string;
  description?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    // Field top-aligns controls next to a FieldContent; center them on the label instead.
    <Field
      orientation="horizontal"
      className="justify-between gap-6 px-4 py-3 has-[>[data-slot=field-content]]:items-center"
    >
      <FieldContent>
        <FieldLabel htmlFor={htmlFor}>{label}</FieldLabel>
        {description && <FieldDescription>{description}</FieldDescription>}
      </FieldContent>
      {children}
    </Field>
  );
}

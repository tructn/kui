import { RotateCcwIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

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

/** The app's one Settings dialog. Open it from anywhere with `useSettingsDialog().show()`, or ⌘,. */
export function SettingsDialog() {
  const { open, setOpen } = useSettingsDialog();
  const show = useSettingsDialog((s) => s.show);
  // ⌘, is the macOS convention for preferences.
  useShortcut("mod+,", show);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription className="sr-only">App appearance.</DialogDescription>
        </DialogHeader>
        <AppearanceSettings />
        <KeyboardShortcuts />
      </DialogContent>
    </Dialog>
  );
}

function AppearanceSettings() {
  const theme = useTheme((s) => s.theme);
  const toggleTheme = useTheme((s) => s.toggleTheme);
  const { uiFont, codeFont, codeFontSize, codeLigatures, update, reset } = useAppearance();

  return (
    <FieldSet>
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <FieldLegend>Appearance</FieldLegend>
          <FieldDescription>Applies right away and is remembered on this machine.</FieldDescription>
        </div>
        <Button variant="ghost" size="sm" onClick={reset}>
          <RotateCcwIcon /> Reset fonts
        </Button>
      </div>
      <FieldGroup>
        <SettingRow label="Theme">
          <Select value={theme} onValueChange={(v) => v !== theme && toggleTheme()}>
            <SelectTrigger size="sm" className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(["dark", "light"] satisfies Theme[]).map((t) => (
                <SelectItem key={t} value={t} className="capitalize">
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>

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

        <pre className="overflow-x-auto rounded-lg border bg-muted/40 p-3 font-mono text-[length:var(--app-code-size)] leading-relaxed">
          {`{ "orderId": "o-1001", "total": 129.90, "status": "PAID" } // => 0O1lI`}
        </pre>
      </FieldGroup>
    </FieldSet>
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
    <FieldSet className="mt-8">
      <FieldLegend>Keyboard shortcuts</FieldLegend>
      <dl className="grid grid-cols-[auto_1fr] items-center gap-x-6 gap-y-2 text-sm">
        {SHORTCUTS.map(([keys, action]) => (
          <div key={action} className="contents">
            <dt>
              <ShortcutHint keys={keys} />
              <span className="sr-only">{keys.join(" + ")}</span>
            </dt>
            <dd className="text-muted-foreground">{action}</dd>
          </div>
        ))}
      </dl>
    </FieldSet>
  );
}

function SettingRow({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  return (
    <Field orientation="horizontal" className="justify-between">
      <FieldLabel htmlFor={htmlFor}>{label}</FieldLabel>
      {children}
    </Field>
  );
}

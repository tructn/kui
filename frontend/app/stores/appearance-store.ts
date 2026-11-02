import { create } from "zustand";
import { persist } from "zustand/middleware";

import { applyAccent, DEFAULT_ACCENT, isAccent, type Accent } from "@/lib/accent";
import { settingsStorage } from "@/lib/settings-storage";

export { ACCENTS, type Accent } from "@/lib/accent";

/** Fonts the user can pick in Settings → Appearance. All but "system" ship with the app. */
export const UI_FONTS = {
  inter: { label: "Inter", stack: "'Inter Variable', ui-sans-serif, system-ui, sans-serif" },
  geist: { label: "Geist", stack: "'Geist Variable', ui-sans-serif, system-ui, sans-serif" },
  system: { label: "System", stack: "ui-sans-serif, system-ui, -apple-system, sans-serif" },
} as const;

export const CODE_FONTS = {
  "jetbrains-mono": { label: "JetBrains Mono", stack: "'JetBrains Mono Variable', ui-monospace, monospace" },
  "geist-mono": { label: "Geist Mono", stack: "'Geist Mono Variable', ui-monospace, monospace" },
  "fira-code": { label: "Fira Code", stack: "'Fira Code Variable', ui-monospace, monospace" },
  "cascadia-code": { label: "Cascadia Code", stack: "'Cascadia Code Variable', ui-monospace, monospace" },
  "source-code-pro": { label: "Source Code Pro", stack: "'Source Code Pro Variable', ui-monospace, monospace" },
  "roboto-mono": { label: "Roboto Mono", stack: "'Roboto Mono Variable', ui-monospace, monospace" },
  "victor-mono": { label: "Victor Mono", stack: "'Victor Mono Variable', ui-monospace, monospace" },
  system: { label: "System", stack: "ui-monospace, SFMono-Regular, Menlo, monospace" },
} as const;

export type UiFont = keyof typeof UI_FONTS;
export type CodeFont = keyof typeof CODE_FONTS;

export const CODE_FONT_SIZES = [11, 12, 13, 14, 15, 16] as const;

interface Appearance {
  accent: Accent;
  uiFont: UiFont;
  codeFont: CodeFont;
  /** Editor font size in px. */
  codeFontSize: number;
  /** Programming ligatures like `->`, `=>`, `!=` (JetBrains Mono, Fira Code, Cascadia Code, Victor Mono). */
  codeLigatures: boolean;
}

interface AppearanceState extends Appearance {
  update: (patch: Partial<Appearance>) => void;
  /** Restores the default fonts; the accent color is kept. */
  resetFonts: () => void;
}

const DEFAULTS: Appearance = {
  accent: DEFAULT_ACCENT,
  uiFont: "inter",
  codeFont: "jetbrains-mono",
  codeFontSize: 13,
  codeLigatures: true,
};

export const useAppearance = create<AppearanceState>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      update: (patch) => set(patch),
      resetFonts: () => set(({ accent }) => ({ ...DEFAULTS, accent })),
    }),
    { name: "kui.appearance", storage: settingsStorage() },
  ),
);

/** `index.css` maps Tailwind's font-sans / font-mono onto these variables. */
function applyAppearance({ accent, uiFont, codeFont, codeFontSize, codeLigatures }: Appearance) {
  const root = document.documentElement;
  const style = root.style;
  // A stale or hand-edited accent falls back to the default.
  applyAccent(root, isAccent(accent) ? accent : DEFAULTS.accent);
  // A stale persisted key (e.g. a font that was removed) falls back to the default.
  style.setProperty("--app-font-sans", (UI_FONTS[uiFont] ?? UI_FONTS[DEFAULTS.uiFont]).stack);
  style.setProperty("--app-font-mono", (CODE_FONTS[codeFont] ?? CODE_FONTS[DEFAULTS.codeFont]).stack);
  style.setProperty("--app-code-size", `${codeFontSize}px`);
  style.setProperty("--app-code-ligatures", codeLigatures ? "normal" : "none");
}

// Same pattern as the theme store: apply at startup, then on every change.
applyAppearance(useAppearance.getState());
useAppearance.subscribe(applyAppearance);

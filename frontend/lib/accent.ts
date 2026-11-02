/**
 * Accent colors. A preset's real light/dark values live in `index.css` per
 * `data-accent`; `swatch` is only for drawing the picker. Anything else is a
 * custom `#rrggbb` color picked by the user, applied as inline CSS variables.
 */
export const ACCENTS = {
  rose: { label: "Rose", swatch: "oklch(0.645 0.246 16.439)" },
  orange: { label: "Orange", swatch: "oklch(0.646 0.222 41.116)" },
  green: { label: "Green", swatch: "oklch(0.627 0.194 149.214)" },
  teal: { label: "Teal", swatch: "oklch(0.6 0.118 184.704)" },
  blue: { label: "Blue", swatch: "oklch(0.623 0.214 259.815)" },
  violet: { label: "Violet", swatch: "oklch(0.606 0.25 292.717)" },
  neutral: { label: "Neutral", swatch: "oklch(0.556 0 0)" },
} as const;

export type AccentPreset = keyof typeof ACCENTS;
/** A preset name, or a custom color as `#rrggbb`. */
export type Accent = AccentPreset | `#${string}`;

export const DEFAULT_ACCENT: AccentPreset = "rose";

export const isPreset = (value: string): value is AccentPreset => Object.hasOwn(ACCENTS, value);
export const isCustomColor = (value: string): value is `#${string}` => /^#[0-9a-f]{6}$/i.test(value);
export const isAccent = (value: unknown): value is Accent =>
  typeof value === "string" && (isPreset(value) || isCustomColor(value));

// The same near-white and near-black the presets use for text on the accent.
const LIGHT_TEXT = "oklch(0.985 0 0)";
const DARK_TEXT = "oklch(0.205 0 0)";
/**
 * Above this luminance, text turns dark. Strict WCAG contrast flips to dark text
 * near 0.18, which puts black on mid-tone blues, reds and purples where white reads
 * better. 0.4 keeps white on those and only goes dark on yellows, limes and pastels.
 */
const DARK_TEXT_ABOVE = 0.4;

/** WCAG relative luminance of a `#rrggbb` color. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** White text on the accent, unless the accent is light enough to need dark text. */
export function readableForeground(hex: string): string {
  return luminance(hex) > DARK_TEXT_ABOVE ? DARK_TEXT : LIGHT_TEXT;
}

/**
 * Presets switch on `data-accent` (see `index.css`). A custom color sets
 * `--brand` inline, which beats those rules, and is the same in light and dark.
 */
export function applyAccent(root: HTMLElement, accent: Accent) {
  if (isCustomColor(accent)) {
    root.dataset.accent = "custom";
    root.style.setProperty("--brand", accent);
    root.style.setProperty("--brand-foreground", readableForeground(accent));
  } else {
    root.dataset.accent = isPreset(accent) ? accent : DEFAULT_ACCENT;
    root.style.removeProperty("--brand");
    root.style.removeProperty("--brand-foreground");
  }
}

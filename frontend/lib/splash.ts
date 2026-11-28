/**
 * The splash screen in index.html paints before the CSS bundle and settings load,
 * so it reads these hints, saved on the previous run, to match the theme and accent.
 */
const THEME_KEY = "kui-splash-theme";
const ACCENT_KEY = "kui-splash-accent";

function save(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Only cosmetic.
  }
}

export function rememberSplashTheme(theme: string) {
  save(THEME_KEY, theme);
}

/**
 * Saves the painted `--brand` rather than the accent name: preset values differ between
 * light and dark and live only in index.css. Call it after the theme or accent changes.
 */
export function rememberSplashAccent() {
  const brand = getComputedStyle(document.documentElement).getPropertyValue("--brand").trim();
  if (brand) save(ACCENT_KEY, brand);
}

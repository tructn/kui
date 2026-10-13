import { create } from "zustand";
import { persist } from "zustand/middleware";

import { settingsStorage } from "@/lib/settings-storage";

export type Theme = "light" | "dark";

interface ThemeState {
  theme: Theme;
  toggleTheme: () => void;
}

export const useTheme = create<ThemeState>()(
  persist(
    (set) => ({
      theme: "dark",
      toggleTheme: () => set((s) => ({ theme: s.theme === "dark" ? "light" : "dark" })),
    }),
    { name: "kui.theme", storage: settingsStorage() },
  ),
);

/** shadcn's CSS variables switch on the `dark` class of <html>. */
function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  // The splash screen in index.html paints before settings load; this hint lets it match the theme.
  try {
    localStorage.setItem("kui-splash-theme", theme);
  } catch {
    // Only cosmetic.
  }
}

// Runs once at startup, then on every change — no provider component needed.
applyTheme(useTheme.getState().theme);
useTheme.subscribe((state) => applyTheme(state.theme));

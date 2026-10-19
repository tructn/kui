import { create } from "zustand";
import { persist } from "zustand/middleware";

import { settingsStorage } from "@/lib/settings-storage";

/** What the user picked; "system" follows the OS appearance. */
export type Theme = "system" | "light" | "dark";
/** What is actually painted. */
export type ResolvedTheme = "light" | "dark";

interface ThemeState {
  theme: Theme;
  /** Live OS preference; not persisted. */
  systemDark: boolean;
  setTheme: (theme: Theme) => void;
  /** Flips what is shown, leaving "system" for an explicit choice. */
  toggleTheme: () => void;
}

const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

export const resolveTheme = (s: Pick<ThemeState, "theme" | "systemDark">): ResolvedTheme =>
  s.theme === "system" ? (s.systemDark ? "dark" : "light") : s.theme;

export const useTheme = create<ThemeState>()(
  persist(
    (set) => ({
      theme: "system",
      systemDark: darkQuery.matches,
      setTheme: (theme) => set({ theme }),
      toggleTheme: () => set((s) => ({ theme: resolveTheme(s) === "dark" ? "light" : "dark" })),
    }),
    {
      name: "kui.theme",
      storage: settingsStorage(),
      partialize: (s) => ({ theme: s.theme }),
    },
  ),
);

/** The theme currently painted, following the OS when set to "system". */
export const useResolvedTheme = () => useTheme(resolveTheme);

/** shadcn's CSS variables switch on the `dark` class of <html>. */
function applyTheme(state: ThemeState) {
  document.documentElement.classList.toggle("dark", resolveTheme(state) === "dark");
  // The splash screen in index.html paints before settings load; this hint lets it match the theme.
  try {
    localStorage.setItem("kui-splash-theme", state.theme);
  } catch {
    // Only cosmetic.
  }
}

// Runs once at startup, then on every change — no provider component needed.
applyTheme(useTheme.getState());
useTheme.subscribe(applyTheme);
darkQuery.addEventListener("change", (e) => useTheme.setState({ systemDark: e.matches }));

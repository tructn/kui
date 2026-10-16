import { create } from "zustand";
import { persist } from "zustand/middleware";

import { settingsStorage } from "@/lib/settings-storage";

interface ViewStateStore {
  /** Settings → General: keep sorting and filters across pages and restarts. */
  remember: boolean;
  /** Values by view id (e.g. "topics.sort"), saved to disk while `remember` is on. */
  saved: Record<string, unknown>;
  /** The same while `remember` is off: in memory, and dropped when the view unmounts. */
  session: Record<string, unknown>;
  setRemember: (remember: boolean) => void;
  set: (id: string, value: unknown) => void;
  forget: (id: string) => void;
}

/**
 * Table sorting and list filters. Read and write it through `useViewState`,
 * which picks `saved` or `session` from the `remember` setting.
 */
export const useViewStateStore = create<ViewStateStore>()(
  persist(
    (set) => ({
      remember: true,
      saved: {},
      session: {},
      // Turning it off forgets what was saved; turning it on keeps what's on screen.
      setRemember: (remember) =>
        set((s) => (remember ? { remember, saved: { ...s.session } } : { remember, saved: {} })),
      set: (id, value) => set((s) => (s.remember ? { saved: { ...s.saved, [id]: value } } : { session: { ...s.session, [id]: value } })),
      forget: (id) =>
        set((s) => {
          if (!(id in s.session)) return s;
          const session = { ...s.session };
          delete session[id];
          return { session };
        }),
    }),
    {
      name: "kui.views",
      storage: settingsStorage(),
      partialize: (s) => ({ remember: s.remember, saved: s.saved }) as ViewStateStore,
    },
  ),
);

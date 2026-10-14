import { create } from "zustand";
import { persist } from "zustand/middleware";

import { callCommand } from "@/lib/invoke";
import { settingsStorage } from "@/lib/settings-storage";

/** Mirrors `AvailableUpdate` in `src-tauri/src/updates.rs`. */
export interface AvailableUpdate {
  version: string;
  currentVersion: string;
  /** Release notes, as Markdown. */
  notes: string | null;
  prerelease: boolean;
}

interface UpdatePrefs {
  /** Check at startup and every few hours while the app is open. */
  checkAutomatically: boolean;
  /** Also offer release candidates (pre-releases such as 0.3.0-rc.1). */
  includeReleaseCandidates: boolean;
}

interface UpdateState extends UpdatePrefs {
  /** The newer version found by the last check, if any. */
  available: AvailableUpdate | null;
  dialogOpen: boolean;
  setPrefs: (patch: Partial<UpdatePrefs>) => void;
  setDialogOpen: (open: boolean) => void;
  /** Asks GitHub for a newer version on the chosen channel. */
  check: () => Promise<AvailableUpdate | null>;
}

export const useUpdates = create<UpdateState>()(
  persist(
    (set, get) => ({
      checkAutomatically: true,
      includeReleaseCandidates: false,
      available: null,
      dialogOpen: false,
      setPrefs: (patch) => set(patch),
      setDialogOpen: (dialogOpen) => set({ dialogOpen }),
      check: async () => {
        const available = await callCommand<AvailableUpdate | null>("check_for_update", {
          includePrereleases: get().includeReleaseCandidates,
        });
        set({ available });
        return available;
      },
    }),
    {
      name: "kui.updates",
      storage: settingsStorage(),
      // Only the preferences are remembered; a found update is re-checked each run.
      partialize: ({ checkAutomatically, includeReleaseCandidates }) => ({
        checkAutomatically,
        includeReleaseCandidates,
      }),
    },
  ),
);

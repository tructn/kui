import { create } from "zustand";
import { persist } from "zustand/middleware";

import { settingsStorage } from "@/lib/settings-storage";

interface PanelWidthState {
  /** Width in px the user dragged each side panel to, by panel id. */
  widths: Record<string, number>;
  setWidth: (panel: string, width: number) => void;
}

/** Remembers side panel widths across restarts. */
export const usePanelWidths = create<PanelWidthState>()(
  persist(
    (set) => ({
      widths: {},
      setWidth: (panel, width) => set((s) => ({ widths: { ...s.widths, [panel]: width } })),
    }),
    { name: "kui.panel-widths", storage: settingsStorage() },
  ),
);

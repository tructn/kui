import { create } from "zustand";

interface SettingsDialogState {
  open: boolean;
  show: () => void;
  setOpen: (open: boolean) => void;
}

/** Lets any page open the one Settings dialog mounted in the app shell. */
export const useSettingsDialog = create<SettingsDialogState>()((set) => ({
  open: false,
  show: () => set({ open: true }),
  setOpen: (open) => set({ open }),
}));

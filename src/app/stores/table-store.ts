import { create } from "zustand";
import { persist } from "zustand/middleware";

import { settingsStorage } from "@/lib/settings-storage";

interface TableState {
  /** Rows per page, shared by every table so the choice sticks. */
  pageSize: number;
  setPageSize: (pageSize: number) => void;
  /** Column widths in px by table id, set when the user resizes a column (see `useColumnResize`). */
  columnWidths: Record<string, number[]>;
  /** `null` goes back to automatic widths. */
  setColumnWidths: (tableId: string, widths: number[] | null) => void;
}

export const useTablePrefs = create<TableState>()(
  persist(
    (set) => ({
      pageSize: 50,
      setPageSize: (pageSize) => set({ pageSize }),
      columnWidths: {},
      setColumnWidths: (tableId, widths) =>
        set((state) => {
          const columnWidths = { ...state.columnWidths };
          if (widths) columnWidths[tableId] = widths;
          else delete columnWidths[tableId];
          return { columnWidths };
        }),
    }),
    { name: "kui.tables", storage: settingsStorage() },
  ),
);

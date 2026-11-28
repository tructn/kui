import { create } from "zustand";
import { persist } from "zustand/middleware";

import { withPins } from "@/lib/column-widths";
import { settingsStorage } from "@/lib/settings-storage";

interface TableState {
  /** Rows per page, shared by every table except messages so the choice sticks. */
  pageSize: number;
  setPageSize: (pageSize: number) => void;
  /** Rows per page for messages, kept apart: message rows are taller and each page is read from Kafka. */
  messagePageSize: number;
  setMessagePageSize: (pageSize: number) => void;
  /** Column widths in px by table id, set when the user resizes a column (see `useColumnResize`). */
  columnWidths: Record<string, number[]>;
  /** `null` goes back to automatic widths. */
  setColumnWidths: (tableId: string, widths: number[] | null) => void;
  /** Pinned column indices by `pinKey`: one table instance, not every table of its kind. */
  pinnedColumns: Record<string, number[]>;
  /** `null` or empty unpins every column. */
  setPinnedColumns: (key: string, pinned: number[] | null) => void;
}

export const useTablePrefs = create<TableState>()(
  persist(
    (set) => ({
      pageSize: 50,
      setPageSize: (pageSize) => set({ pageSize }),
      messagePageSize: 25,
      setMessagePageSize: (messagePageSize) => set({ messagePageSize }),
      columnWidths: {},
      setColumnWidths: (tableId, widths) =>
        set((state) => {
          const columnWidths = { ...state.columnWidths };
          if (widths) columnWidths[tableId] = widths;
          else delete columnWidths[tableId];
          return { columnWidths };
        }),
      pinnedColumns: {},
      setPinnedColumns: (key, pinned) =>
        set((state) => ({ pinnedColumns: withPins(state.pinnedColumns, key, pinned) })),
    }),
    { name: "kui.tables", storage: settingsStorage() },
  ),
);

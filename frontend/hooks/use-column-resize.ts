import { useState, type KeyboardEvent, type PointerEvent } from "react";

import { useTablePrefs } from "@/app/stores/table-store";
import { resizeColumn, togglePinned, type ColumnLayout } from "@/lib/column-widths";

/** How far ← / → move a focused resize handle, in px. */
const KEY_STEP = 16;

const NONE: readonly number[] = [];

/** Passed to `<Table resize={...}>`; the table's headers then get drag handles. */
export interface ColumnResize {
  /** Column widths in px, or null for the browser's automatic layout. */
  widths: number[] | null;
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  /** Indices of the columns that stay on screen while the table scrolls sideways. Empty without `widths`. */
  pinned: readonly number[];
  /** Pins or unpins the column of the header cell holding `control`. */
  togglePin: (control: HTMLElement) => void;
  /** Back to automatic widths, with no column pinned. */
  reset: () => void;
}

/**
 * Drag-to-resize columns for one table, remembered across restarts by `tableId`.
 *
 * Only the dragged column changes size. A wider column can push the table past
 * its frame, which then scrolls sideways; a narrower one shrinks the table, but
 * never below the frame's width: any gap goes to the neighbouring column, so
 * the table always fills its frame. Header and body cells share the table's
 * column widths, so they always stay aligned.
 *
 * A pinned column sticks to the frame's left edge (after any pinned columns
 * before it). Its offset depends on those widths, so pinning first fixes the
 * current widths, as a resize does; pins only apply while widths are set.
 *
 * `columnCount` guards against widths and pins saved for an older version of the table.
 */
export function useColumnResize(tableId: string, columnCount: number): ColumnResize {
  const saved = useTablePrefs((s) => s.columnWidths[tableId]);
  const save = useTablePrefs((s) => s.setColumnWidths);
  const savedPins = useTablePrefs((s) => s.pinnedColumns[tableId]);
  const savePins = useTablePrefs((s) => s.setPinnedColumns);
  // Widths while dragging; saved (one settings write) when the pointer is released.
  const [draft, setDraft] = useState<number[] | null>(null);
  const current = draft ?? (isValid(saved, columnCount) ? saved : null);
  const pinned = current && savedPins ? savedPins.filter((c) => c >= 0 && c < columnCount) : NONE;

  function measure(handle: HTMLElement): ColumnLayout | null {
    const cell = handle.closest("th");
    const row = cell?.parentElement as HTMLTableRowElement | null;
    const container = cell?.closest("table")?.parentElement;
    if (!cell || !row || !container) return null;
    return {
      column: cell.cellIndex,
      px: [...row.cells].map((c) => c.getBoundingClientRect().width),
      available: container.getBoundingClientRect().width,
    };
  }

  return {
    widths: current,
    onPointerDown(event) {
      if (event.button !== 0) return;
      const measured = measure(event.currentTarget);
      if (!measured) return;
      event.preventDefault(); // no text selection while dragging
      const start = measured.px.map(Math.round);
      const startX = event.clientX;
      let latest = start;
      setDraft(start);
      document.body.style.cursor = "col-resize";

      const move = (e: globalThis.PointerEvent) => {
        latest = resizeColumn(measured, e.clientX - startX);
        setDraft(latest);
      };
      const end = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", end);
        window.removeEventListener("pointercancel", end);
        document.body.style.cursor = "";
        // A click (e.g. half of a double-click to reset) shouldn't write settings.
        if (latest.some((w, i) => w !== start[i])) save(tableId, latest);
        setDraft(null);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", end);
      window.addEventListener("pointercancel", end);
    },
    onKeyDown(event) {
      const delta = event.key === "ArrowRight" ? KEY_STEP : event.key === "ArrowLeft" ? -KEY_STEP : 0;
      if (!delta) return;
      const measured = measure(event.currentTarget);
      if (!measured) return;
      event.preventDefault();
      save(tableId, resizeColumn(measured, delta));
    },
    pinned,
    togglePin(control) {
      const measured = measure(control);
      if (!measured) return;
      if (!current) save(tableId, measured.px.map(Math.round));
      savePins(tableId, togglePinned(pinned, measured.column));
    },
    reset() {
      save(tableId, null);
      savePins(tableId, null);
    },
  };
}

/**
 * Saved widths fit this table: one positive width per column. (Not checked
 * against the drag minimum: some columns, like checkboxes, start narrower.)
 */
function isValid(widths: number[] | undefined, columnCount: number): widths is number[] {
  return !!widths && widths.length === columnCount && widths.every((w) => Number.isFinite(w) && w > 0);
}

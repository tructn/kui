import { useState, type KeyboardEvent, type PointerEvent } from "react";

import { useTablePrefs } from "@/app/stores/table-store";
import { resizeColumn, type ColumnLayout } from "@/lib/column-widths";

/** How far ← / → move a focused resize handle, in px. */
const KEY_STEP = 16;

/** Passed to `<Table resize={...}>`; the table's headers then get drag handles. */
export interface ColumnResize {
  /** Column widths in px, or null for the browser's automatic layout. */
  widths: number[] | null;
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  /** Back to automatic widths. */
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
 * `columnCount` guards against widths saved for an older version of the table.
 */
export function useColumnResize(tableId: string, columnCount: number): ColumnResize {
  const saved = useTablePrefs((s) => s.columnWidths[tableId]);
  const save = useTablePrefs((s) => s.setColumnWidths);
  // Widths while dragging; saved (one settings write) when the pointer is released.
  const [draft, setDraft] = useState<number[] | null>(null);
  const current = draft ?? (isValid(saved, columnCount) ? saved : null);

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
    reset: () => save(tableId, null),
  };
}

/**
 * Saved widths fit this table: one positive width per column. (Not checked
 * against the drag minimum: some columns, like checkboxes, start narrower.)
 */
function isValid(widths: number[] | undefined, columnCount: number): widths is number[] {
  return !!widths && widths.length === columnCount && widths.every((w) => Number.isFinite(w) && w > 0);
}

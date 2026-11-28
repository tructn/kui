import { useState, type KeyboardEvent, type PointerEvent } from "react";

import { useTablePrefs } from "@/app/stores/table-store";
import {
  displayOrder,
  measuredWidths,
  permute,
  pinKey,
  resizeColumn,
  togglePinned,
  unpermute,
  validPins,
  type ColumnLayout,
} from "@/lib/column-widths";

/** How far ← / → move a focused resize handle, in px. */
const KEY_STEP = 16;

/** Passed to `<Table resize={...}>`; the table's headers then get drag handles. */
export interface ColumnResize {
  /** Column widths in px in display order, or null for the browser's automatic layout. */
  widths: number[] | null;
  /**
   * The column each display slot shows (see `displayOrder`), or null while
   * nothing is pinned. Rows render their cells in this order.
   */
  order: readonly number[] | null;
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  /** How many leading display slots are pinned: they stay on screen while the table scrolls sideways. */
  pinnedCount: number;
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
 * Pinned columns move to the front, in the order they were pinned, and stick
 * to the frame's left edge; the columns they jumped over (like the expand
 * toggle) follow them instead of scrolling underneath. Their offsets depend on
 * the widths, so pinning first fixes the current widths, as a resize does;
 * pins only apply while widths are set. Widths are saved in column order and
 * shown in display order.
 *
 * Widths are shared by every table of the kind `tableId`; pins belong to the
 * one table `scope` names (e.g. `[clusterId, topic]`), so pinning a column of
 * one topic's partitions doesn't pin it for every topic.
 *
 * `columnCount` guards against widths and pins saved for an older version of the table.
 */
export function useColumnResize(tableId: string, columnCount: number, scope: readonly string[]): ColumnResize {
  const saved = useTablePrefs((s) => s.columnWidths[tableId]);
  const save = useTablePrefs((s) => s.setColumnWidths);
  const pinsAt = pinKey(tableId, scope);
  const savedPins = useTablePrefs((s) => s.pinnedColumns[pinsAt]);
  const savePins = useTablePrefs((s) => s.setPinnedColumns);
  // Widths while dragging; saved (one settings write) when the pointer is released.
  const [draft, setDraft] = useState<number[] | null>(null);
  const current = draft ?? (isValid(saved, columnCount) ? saved : null);
  const pinned = current && savedPins ? validPins(columnCount, savedPins) : [];
  const order = pinned.length > 0 ? displayOrder(columnCount, pinned) : null;
  const toColumns = (px: number[]) => (order ? unpermute(px, order) : px);

  /** The layout in display order, which is what a drag or the neighbour rule sees. */
  function measure(handle: HTMLElement): ColumnLayout | null {
    const cell = handle.closest("th");
    const row = cell?.parentElement as HTMLTableRowElement | null;
    const container = cell?.closest("table")?.parentElement;
    if (!cell || !row || !container) return null;
    return {
      column: cell.cellIndex,
      px: measuredWidths([...row.cells].map((c) => c.getBoundingClientRect().width)),
      available: container.getBoundingClientRect().width,
    };
  }

  return {
    widths: current && order ? permute(current, order) : current,
    order,
    pinnedCount: pinned.length,
    onPointerDown(event) {
      if (event.button !== 0) return;
      const measured = measure(event.currentTarget);
      if (!measured) return;
      event.preventDefault(); // no text selection while dragging
      const start = toColumns(measured.px);
      const startX = event.clientX;
      let latest = start;
      setDraft(start);
      document.body.style.cursor = "col-resize";

      const move = (e: globalThis.PointerEvent) => {
        latest = toColumns(resizeColumn(measured, e.clientX - startX));
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
      save(tableId, toColumns(resizeColumn(measured, delta)));
    },
    togglePin(control) {
      const measured = measure(control);
      if (!measured) return;
      if (!current) save(tableId, toColumns(measured.px));
      savePins(pinsAt, togglePinned(pinned, order ? order[measured.column] : measured.column));
    },
    reset() {
      save(tableId, null);
      savePins(pinsAt, null);
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

import { useRef, useState, type KeyboardEvent } from "react";

/**
 * Keyboard support for a table whose rows open something when clicked.
 *
 * Only one row is in the Tab order (a "roving tabindex"), so Tab moves past the
 * table in one step. Inside it: ↑/↓ (or k/j) move between rows, Home/End jump to
 * the first/last row, and Enter or Space opens the focused row.
 */
export function useRowNavigation(count: number) {
  const [active, setActive] = useState(0);
  const rows = useRef<(HTMLTableRowElement | null)[]>([]);
  const current = Math.min(active, Math.max(0, count - 1));

  function focusRow(index: number) {
    const next = Math.min(Math.max(0, index), count - 1);
    setActive(next);
    rows.current[next]?.focus();
  }

  return function rowProps(index: number, open: () => void) {
    return {
      ref: (el: HTMLTableRowElement | null) => {
        rows.current[index] = el;
      },
      tabIndex: index === current ? 0 : -1,
      onFocus: () => setActive(index),
      onClick: open,
      onKeyDown: (event: KeyboardEvent<HTMLTableRowElement>) => {
        // Keys pressed on a control inside the row (a checkbox, a menu) are its own.
        if (event.target !== event.currentTarget) return;
        switch (event.key) {
          case "ArrowDown":
          case "j":
            focusRow(index + 1);
            break;
          case "ArrowUp":
          case "k":
            focusRow(index - 1);
            break;
          case "Home":
            focusRow(0);
            break;
          case "End":
            focusRow(count - 1);
            break;
          case "Enter":
          case " ":
            open();
            break;
          default:
            return;
        }
        event.preventDefault();
      },
      className: "cursor-pointer outline-none focus-visible:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
    };
  };
}

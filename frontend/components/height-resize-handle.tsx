import { useState, type KeyboardEvent, type PointerEvent, type RefObject } from "react";

import { cn } from "@/lib/utils";

/** How far ↑ / ↓ move a focused handle, in px. */
const KEY_STEP = 24;

interface HeightResizeHandleProps {
  /** The element above the handle whose height is dragged. */
  target: RefObject<HTMLElement | null>;
  /** Current height in px, or null while the target keeps its default size. */
  height: number | null;
  min: number;
  /** Space always left in the target's parent for what sits below it. */
  reserve: number;
  onResize: (height: number | null) => void;
  label: string;
}

/** A horizontal bar under an element: drag it, or focus it and use ↑ / ↓, to change the element's height. */
export function HeightResizeHandle({ target, height, min, reserve, onResize, label }: HeightResizeHandleProps) {
  const [dragging, setDragging] = useState(false);

  // Measured on each use, so the limits follow the window as it is resized.
  function bounds(): { current: number; max: number } | null {
    const element = target.current;
    const parent = element?.parentElement;
    if (!element || !parent) return null;
    const max = Math.max(min, parent.getBoundingClientRect().height - reserve);
    return { current: element.getBoundingClientRect().height, max };
  }

  const clamp = (value: number, max: number) => Math.round(Math.min(Math.max(value, min), max));

  function startDrag(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const measured = bounds();
    if (!measured) return;
    event.preventDefault(); // no text selection while dragging
    const startY = event.clientY;
    setDragging(true);
    document.body.style.cursor = "row-resize";

    const move = (e: globalThis.PointerEvent) => onResize(clamp(measured.current + e.clientY - startY, measured.max));
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      document.body.style.cursor = "";
      setDragging(false);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  }

  function nudge(event: KeyboardEvent<HTMLDivElement>) {
    const delta = event.key === "ArrowDown" ? KEY_STEP : event.key === "ArrowUp" ? -KEY_STEP : 0;
    const measured = delta ? bounds() : null;
    if (!measured) return;
    event.preventDefault();
    onResize(clamp(measured.current + delta, measured.max));
  }

  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label={label}
      aria-valuenow={height ?? undefined}
      aria-valuemin={min}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      className={cn(
        "group relative z-10 -my-1 h-2 shrink-0 cursor-row-resize outline-none",
        "after:absolute after:inset-x-0 after:top-1/2 after:h-px after:-translate-y-1/2 after:bg-border after:transition-colors",
        "hover:after:h-1 hover:after:bg-primary/40 focus-visible:after:h-1 focus-visible:after:bg-primary/60",
        dragging && "after:h-1 after:bg-primary/60",
      )}
      onPointerDown={startDrag}
      onKeyDown={nudge}
      onDoubleClick={() => onResize(null)}
    />
  );
}

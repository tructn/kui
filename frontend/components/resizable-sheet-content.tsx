import { useState, type ComponentProps, type PointerEvent } from "react";

import { usePanelWidths } from "@/app/stores/panel-width-store";
import { SheetContent } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const MIN_WIDTH = 400;
/** Always leave some of the page visible, so the panel can be closed by clicking beside it. */
const PAGE_MARGIN = 80;

interface ResizableSheetContentProps extends ComponentProps<typeof SheetContent> {
  /** Remembers this panel's width under this id. */
  panelId: string;
  /** Width in px until the user drags the edge. */
  defaultWidth: number;
}

/** A right-side sheet whose left edge can be dragged to make it wider or narrower. */
export function ResizableSheetContent({
  panelId,
  defaultWidth,
  className,
  style,
  children,
  ...props
}: ResizableSheetContentProps) {
  const saved = usePanelWidths((s) => s.widths[panelId]);
  const setWidth = usePanelWidths((s) => s.setWidth);
  const [dragging, setDragging] = useState(false);
  const width = clamp(saved ?? defaultWidth);

  function startDrag(e: PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
  }

  function drag(e: PointerEvent<HTMLDivElement>) {
    if (dragging) setWidth(panelId, clamp(window.innerWidth - e.clientX));
  }

  return (
    <SheetContent
      className={cn("w-full gap-0 sm:max-w-none data-[side=right]:sm:max-w-none", dragging && "select-none", className)}
      style={{ ...style, width }}
      {...props}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panel"
        title="Drag to resize · double-click to reset"
        className={cn(
          "absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize transition-colors hover:bg-primary/30",
          dragging && "bg-primary/40",
        )}
        onPointerDown={startDrag}
        onPointerMove={drag}
        onPointerUp={() => setDragging(false)}
        onPointerCancel={() => setDragging(false)}
        onDoubleClick={() => setWidth(panelId, defaultWidth)}
      />
      {children}
    </SheetContent>
  );
}

function clamp(width: number): number {
  const max = Math.max(MIN_WIDTH, window.innerWidth - PAGE_MARGIN);
  return Math.round(Math.min(Math.max(width, MIN_WIDTH), max));
}

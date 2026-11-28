"use client"

import * as React from "react"
import { Pin02Icon, PinOffIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { ColumnResize } from "@/hooks/use-column-resize"
import { pinnedColumnsCss } from "@/lib/column-widths"
import { cn } from "@/lib/utils"

/** Set by a `<Table resize>`: its headers get drag handles and pin buttons, its cells truncate. */
const ColumnResizeContext = React.createContext<ColumnResize | null>(null)

function Table({
  className,
  style,
  children,
  resize,
  ...props
}: React.ComponentProps<"table"> & { resize?: ColumnResize }) {
  const widths = resize?.widths
  const pinScope = React.useId()
  const pinned = widths && resize.pinnedCount > 0 ? resize.pinnedCount : 0
  return (
    <div
      data-slot="table-container"
      className="relative w-full overflow-x-auto"
    >
      {pinned > 0 && widths && <style>{pinnedColumnsCss(pinScope, widths, pinned)}</style>}
      <ColumnResizeContext.Provider value={resize ?? null}>
        <table
          data-slot="table"
          data-pin-scope={pinned > 0 ? pinScope : undefined}
          // Fixed widths need fixed layout. The table is as wide as its columns
          // (the frame scrolls sideways when that's wider than it) but never
          // narrower than the frame. Header and body cells share these columns.
          className={cn("w-full caption-bottom text-sm", widths && "table-fixed", className)}
          style={
            widths ? { ...style, width: `max(100%, ${widths.reduce((a, b) => a + b, 0)}px)` } : style
          }
          {...props}
        >
          {widths && (
            <colgroup>
              {widths.map((width, i) => (
                <col key={i} style={{ width }} />
              ))}
            </colgroup>
          )}
          {children}
        </table>
      </ColumnResizeContext.Provider>
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      // Sticks to the top of the scrolling TableFrame. Tables collapse their
      // borders, and a collapsed border stays behind when the header sticks,
      // so the header's bottom line is an inset shadow on the cells instead.
      className={cn(
        "sticky top-0 z-10 bg-background [&_th]:shadow-[inset_0_-1px_0_var(--color-border)] [&_tr]:border-b-0 [&_tr]:hover:[--row-tint:transparent]",
        className
      )}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  )
}

/**
 * The row's background is the `--row-tint` variable, not a `bg-*` class, so
 * pinned cells (see `pinnedColumnsCss`) can paint the same tint over an opaque
 * background. Restyle a row by setting that variable rather than its background.
 */
function TableRow({ className, children, ...props }: React.ComponentProps<"tr">) {
  const order = React.useContext(ColumnResizeContext)?.order
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b bg-(--row-tint) [--row-tint:transparent] even:[--row-tint:var(--color-row-stripe)] hover:[--row-tint:var(--color-muted)] has-aria-expanded:[--row-tint:var(--color-muted)] data-[state=selected]:[--row-tint:var(--color-muted)]",
        className
      )}
      {...props}
    >
      {order ? inDisplayOrder(children, order) : children}
    </tr>
  )
}

/**
 * Cells moved so pinned columns come first (see `useColumnResize`). Rows that
 * don't have one cell per column, like a single `colSpan` cell, stay as they are.
 */
function inDisplayOrder(children: React.ReactNode, order: readonly number[]): React.ReactNode {
  const cells = React.Children.toArray(children)
  return cells.length === order.length ? order.map((column) => cells[column]) : children
}

/**
 * `pinnable={false}` leaves out the pin button, for narrow control columns
 * (checkboxes, expand toggles) where it doesn't fit.
 */
function TableHead({
  className,
  children,
  pinnable = true,
  ...props
}: React.ComponentProps<"th"> & { pinnable?: boolean }) {
  const resize = React.useContext(ColumnResizeContext)
  const ref = React.useRef<HTMLTableCellElement>(null)
  // Read from the DOM: columns are often rendered conditionally, so only the
  // row knows where this cell ended up.
  const [column, setColumn] = React.useState(-1)
  React.useLayoutEffect(() => {
    const index = ref.current?.cellIndex ?? -1
    if (index !== column) setColumn(index)
  })
  const showPin = resize != null && pinnable
  // `column` is the display slot; pinned columns fill the first ones.
  const pinned = showPin && column >= 0 && column < resize.pinnedCount
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-10 px-2 text-left align-middle font-medium whitespace-nowrap text-foreground [&:has([role=checkbox])]:pr-0",
        resize && "group/head relative",
        resize?.widths && "overflow-hidden text-ellipsis",
        className,
        pinned && "pr-8"
      )}
      {...props}
      ref={ref}
    >
      {children}
      {showPin && <ColumnPinButton resize={resize} pinned={pinned} />}
      {resize && <ColumnResizeHandle resize={resize} />}
    </th>
  )
}

/** Shown on hover or focus, and always while the column is pinned. */
function ColumnPinButton({ resize, pinned }: { resize: ColumnResize; pinned: boolean }) {
  const label = pinned ? "Unpin column" : "Pin column, so it stays in view when scrolling sideways"
  return (
    <button
      type="button"
      aria-pressed={pinned}
      aria-label={label}
      title={pinned ? "Unpin column" : "Pin column"}
      onClick={(event) => resize.togglePin(event.currentTarget)}
      className={cn(
        "group/pin absolute top-1/2 right-2.5 inline-flex size-5 -translate-y-1/2 items-center justify-center rounded-sm bg-background text-muted-foreground outline-none hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring",
        pinned ? "text-foreground" : "opacity-0 group-hover/head:opacity-100"
      )}
    >
      <HugeiconsIcon icon={Pin02Icon} className={cn("size-3.5", pinned && "group-hover/pin:hidden")} />
      {pinned && <HugeiconsIcon icon={PinOffIcon} className="hidden size-3.5 group-hover/pin:block" />}
    </button>
  )
}

/**
 * On the column's right edge: drag it (or press ← / → when focused) to resize
 * that column (see `useColumnResize`). Double-click resets the whole table,
 * pins included.
 */
function ColumnResizeHandle({ resize }: { resize: ColumnResize }) {
  return (
    <span
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize column. Double-click to reset all column widths and pins."
      title="Drag to resize. Double-click to reset."
      tabIndex={0}
      onPointerDown={resize.onPointerDown}
      onKeyDown={resize.onKeyDown}
      onDoubleClick={resize.reset}
      className="absolute top-0 right-0 z-10 flex h-full w-2 cursor-col-resize touch-none justify-end outline-none select-none after:my-2.5 after:w-px after:bg-border hover:after:w-0.5 hover:after:bg-ring focus-visible:after:w-0.5 focus-visible:after:bg-ring"
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  const resize = React.useContext(ColumnResizeContext)
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0",
        resize?.widths && "overflow-hidden text-ellipsis",
        className
      )}
      {...props}
    />
  )
}

/**
 * A row spanning every column, for a table's empty or loading message. Its content
 * is pinned to the visible part of the TableFrame (`100cqw` is the frame's width),
 * so it stays centred even when the columns are wider than the frame and the
 * table scrolls sideways.
 */
function TableStateRow({
  colSpan,
  className,
  children,
}: {
  colSpan: number
  className?: string
  children: React.ReactNode
}) {
  return (
    <tr data-slot="table-row" className="hover:[--row-tint:transparent]">
      <td colSpan={colSpan} className="p-0">
        <div
          className={cn(
            "sticky left-0 flex h-24 w-[100cqw] items-center justify-center gap-2 px-2 text-sm text-muted-foreground",
            className
          )}
        >
          {children}
        </div>
      </td>
    </tr>
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
  TableStateRow,
}

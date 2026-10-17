"use client"

import * as React from "react"
import type { ColumnResize } from "@/hooks/use-column-resize"
import { cn } from "@/lib/utils"

/** Set by a `<Table resize>`: its headers get drag handles, its cells truncate. */
const ColumnResizeContext = React.createContext<ColumnResize | null>(null)

function Table({
  className,
  style,
  children,
  resize,
  ...props
}: React.ComponentProps<"table"> & { resize?: ColumnResize }) {
  const widths = resize?.widths
  return (
    <div
      data-slot="table-container"
      className="relative w-full overflow-x-auto"
    >
      <ColumnResizeContext.Provider value={resize ?? null}>
        <table
          data-slot="table"
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
        "sticky top-0 z-10 bg-background [&_th]:shadow-[inset_0_-1px_0_var(--color-border)] [&_tr]:border-b-0 [&_tr]:hover:bg-transparent",
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

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b transition-colors even:bg-muted/40 hover:bg-muted has-aria-expanded:bg-muted data-[state=selected]:bg-muted",
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, children, ...props }: React.ComponentProps<"th">) {
  const resize = React.useContext(ColumnResizeContext)
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-10 px-2 text-left align-middle font-medium whitespace-nowrap text-foreground [&:has([role=checkbox])]:pr-0",
        resize && "relative",
        resize?.widths && "overflow-hidden text-ellipsis",
        className
      )}
      {...props}
    >
      {children}
      {resize && <ColumnResizeHandle resize={resize} />}
    </th>
  )
}

/**
 * On the column's right edge: drag it (or press ← / → when focused) to resize
 * that column (see `useColumnResize`). Double-click resets the whole table.
 */
function ColumnResizeHandle({ resize }: { resize: ColumnResize }) {
  return (
    <span
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize column. Double-click to reset all columns."
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
}

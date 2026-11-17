import { ArrowRightIcon, GripVerticalIcon, PlusIcon, SlidersHorizontalIcon, Trash2Icon } from "lucide-react";
import { useRef, useState, type DragEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatLooseValue, parseLooseValue } from "@/lib/loose-value";
import { cn } from "@/lib/utils";

import { formatSource, parseSource } from "../source";
import { targetNameFor, type SourceGroup } from "../source-fields";
import { TRANSFORM_LABELS, TRANSFORMS, type FieldMapping, type Transform } from "../types";

const AS_IS = "none";
const SOURCE_LIST = "mapping-sources";
/** Taken from, arrow, sent as, buttons: a row reads left to right. */
const ROW_GRID = "grid grid-cols-[minmax(0,1.5fr)_1rem_minmax(0,1fr)_auto] items-center gap-2";
const DRAG_TYPE = "application/x-kui-field";

/** What is typed into a row. Kept as text so typing `true ` on the way to `true love` isn't undone. */
interface Row {
  id: number;
  target: string;
  source: string;
  transform: Transform | null;
  default: string;
}

const toField = (row: Row): FieldMapping => ({
  target: row.target,
  source: parseSource(row.source),
  transform: row.transform,
  default: row.default.trim() === "" ? null : parseLooseValue(row.default),
});

/** A row the user added but never filled in. It is dropped on save instead of being an error. */
export function isBlankMapping(field: FieldMapping): boolean {
  return field.target.trim() === "" && formatSource(field.source).trim() === "";
}

const isFieldDrag = (e: DragEvent) => e.dataTransfer.types.includes(DRAG_TYPE);

interface FieldMappingEditorProps {
  fields: FieldMapping[];
  onChange: (fields: FieldMapping[]) => void;
  groups: SourceGroup[];
}

/**
 * Message fields on the left, the message to send on the right. Dropping a field on the right adds
 * it; dropping it on a row's "from" box swaps that row's source. Clicking a field does the same as
 * dropping it, for keyboards.
 */
export function FieldMappingEditor({ fields, onChange, groups }: FieldMappingEditorProps) {
  const nextId = useRef(0);
  const newRow = (patch: Partial<Row> = {}): Row => ({
    id: nextId.current++,
    target: "",
    source: "",
    transform: null,
    default: "",
    ...patch,
  });
  const [rows, setRows] = useState<Row[]>(() =>
    fields.map((f) =>
      newRow({
        target: f.target,
        source: formatSource(f.source),
        transform: f.transform,
        default: formatLooseValue(f.default),
      }),
    ),
  );
  // Rows whose extra options (conversion, default value) are open; one that already uses them starts open.
  const [open, setOpen] = useState<Set<number>>(
    () => new Set(rows.filter((r) => r.default !== "" || r.transform !== null).map((r) => r.id)),
  );
  // What a dragged field is over: the whole area, or one row's source.
  const [over, setOver] = useState<"area" | number | null>(null);

  function commit(next: Row[]) {
    setRows(next);
    onChange(next.map(toField));
  }
  const update = (id: number, patch: Partial<Row>) => commit(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const toggleOptions = (id: number) =>
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  function addSource(source: string) {
    const target = targetNameFor(
      source,
      rows.map((r) => r.target.trim()),
    );
    commit([...rows, newRow({ target, source })]);
  }
  function replaceSource(id: number, source: string) {
    const row = rows.find((r) => r.id === id);
    if (!row) return;
    const target =
      row.target.trim() === ""
        ? targetNameFor(
            source,
            rows.map((r) => r.target.trim()),
          )
        : row.target;
    update(id, { source, target });
  }

  const dropHandlers = (key: "area" | number, onSource: (source: string) => void) => ({
    onDragOver: (e: DragEvent) => {
      if (!isFieldDrag(e)) return;
      e.preventDefault();
      e.stopPropagation();
      setOver(key);
    },
    onDragLeave: (e: DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver((o) => (o === key ? null : o));
    },
    onDrop: (e: DragEvent) => {
      if (!isFieldDrag(e)) return;
      e.preventDefault();
      e.stopPropagation();
      setOver(null);
      const source = e.dataTransfer.getData(DRAG_TYPE);
      if (source) onSource(source);
    },
  });

  return (
    <div className="grid min-w-0 gap-4 md:grid-cols-[10.5rem_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-3 md:max-h-[28rem] md:overflow-y-auto" aria-label="Message fields" role="group">
        <p className="text-xs font-medium">Message fields</p>
        {groups.map((group) => (
          <div key={group.label} className="flex flex-col gap-1">
            <p className="text-xs text-muted-foreground">{group.label}</p>
            {group.fields.map((field) => (
              <button
                key={field.source}
                type="button"
                draggable
                title="Drag into the message, or click to add"
                aria-label={`Add ${field.source} to the message`}
                onDragStart={(e) => {
                  e.dataTransfer.setData(DRAG_TYPE, field.source);
                  e.dataTransfer.effectAllowed = "copy";
                }}
                onClick={() => addSource(field.source)}
                className="flex cursor-grab items-center gap-1 rounded-md border bg-background px-1.5 py-1 text-left font-mono text-xs outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 active:cursor-grabbing"
              >
                <GripVerticalIcon aria-hidden className="size-3 shrink-0 text-muted-foreground" />
                <span className="truncate">{field.label}</span>
              </button>
            ))}
          </div>
        ))}
        {groups.length === 1 && (
          <p className="text-xs text-muted-foreground">Add a sample message on the right to list its fields.</p>
        )}
      </div>

      <div
        {...dropHandlers("area", addSource)}
        className={cn(
          "flex min-w-0 flex-col gap-2 rounded-lg border border-dashed p-3 transition-colors",
          over === "area" && "border-primary bg-primary/5",
        )}
      >
        <p className="text-xs font-medium">Message to send</p>
        {rows.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Drag fields here, or click one on the left.
          </p>
        )}
        {rows.length > 0 && (
          <div className={cn(ROW_GRID, "px-0.5 text-xs text-muted-foreground")}>
            <span>Taken from</span>
            <span />
            <span>Sent as</span>
            <span className="w-16" />
          </div>
        )}
        {rows.map((row, index) => (
          <div key={row.id} className="flex flex-col gap-1.5">
            <div className={ROW_GRID}>
              <Input
                aria-label={`Field ${index + 1} source`}
                list={SOURCE_LIST}
                className={cn("font-mono", over === row.id && "border-primary ring-3 ring-primary/30")}
                placeholder="value.customer.name"
                value={row.source}
                onChange={(e) => update(row.id, { source: e.target.value })}
                {...dropHandlers(row.id, (source) => replaceSource(row.id, source))}
              />
              <ArrowRightIcon aria-hidden className="size-4 text-muted-foreground" />
              <Input
                aria-label={`Field ${index + 1} name`}
                className="font-mono"
                placeholder="customer.name"
                value={row.target}
                onChange={(e) => update(row.id, { target: e.target.value })}
              />
              <div className="flex">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Options for field ${index + 1}`}
                  aria-pressed={open.has(row.id)}
                  onClick={() => toggleOptions(row.id)}
                >
                  <SlidersHorizontalIcon />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove field ${index + 1}`}
                  onClick={() => commit(rows.filter((r) => r.id !== row.id))}
                >
                  <Trash2Icon />
                </Button>
              </div>
            </div>
            {open.has(row.id) && (
              <div className="ml-1 flex flex-wrap items-center gap-x-4 gap-y-2 border-l-2 pl-3">
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  Convert
                  <Select
                    value={row.transform ?? AS_IS}
                    onValueChange={(t) => update(row.id, { transform: t === AS_IS ? null : (t as Transform) })}
                  >
                    <SelectTrigger aria-label={`Field ${index + 1} conversion`} size="sm" className="w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={AS_IS}>As is</SelectItem>
                      {TRANSFORMS.map((t) => (
                        <SelectItem key={t} value={t}>
                          {TRANSFORM_LABELS[t]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  If missing, send
                  <Input
                    aria-label={`Field ${index + 1} default`}
                    className="h-7 w-40 font-mono text-xs"
                    placeholder="null"
                    value={row.default}
                    onChange={(e) => update(row.id, { default: e.target.value })}
                  />
                </label>
              </div>
            )}
          </div>
        ))}

        <datalist id={SOURCE_LIST}>
          {groups.flatMap((g) => g.fields).map((f) => (
            <option key={f.source} value={f.source} />
          ))}
        </datalist>

        <div>
          <Button type="button" variant="ghost" size="sm" onClick={() => commit([...rows, newRow()])}>
            <PlusIcon /> Add a field by hand
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          In “Taken from” you can also type a fixed value such as <span className="font-mono">kafka</span> or{" "}
          <span className="font-mono">42</span>, or text with <span className="font-mono">{"{{placeholders}}"}</span>.
        </p>
      </div>
    </div>
  );
}

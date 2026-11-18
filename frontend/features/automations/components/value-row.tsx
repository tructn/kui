import { ArrowLeftIcon, EllipsisIcon, RepeatIcon, Trash2Icon, XIcon } from "lucide-react";
import type { DragEvent } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import type { MapNode } from "../mapping-tree";
import { describeValue } from "../sample-fields";
import { parseSource } from "../source";
import { TRANSFORM_LABELS, TRANSFORMS, type Transform } from "../types";

const AS_IS = "none";
export const SOURCE_LIST = "mapping-sources";

type ValueNode = Extract<MapNode, { kind: "value" }>;

export interface DropTarget {
  onDragOver: (e: DragEvent) => void;
  onDragLeave: (e: DragEvent) => void;
  onDrop: (e: DragEvent) => void;
}

interface ValueRowProps {
  node: ValueNode;
  /** What the preview sent for this field; undefined without a sample. */
  sent: unknown;
  /** What the source holds in the sample, before any conversion; undefined when unknown. */
  read: unknown;
  /** The "if missing" box is open, even while empty. */
  defaultOpen: boolean;
  onOpenDefault: (open: boolean) => void;
  onChange: (patch: Partial<ValueNode>) => void;
  onRemove: () => void;
  onMapEach: () => void;
  /** Dropping a field on the source replaces it. */
  drop: DropTarget;
  dropping: boolean;
}

/** `name ← source   value   ⋯`, reading like the JSON it builds. Extras show only once they're set. */
export function ValueRow({
  node,
  sent,
  read,
  defaultOpen,
  onOpenDefault,
  onChange,
  onRemove,
  onMapEach,
  drop,
  dropping,
}: ValueRowProps) {
  const name = node.key.trim() || "new field";
  // Without a sample, any field might be a list.
  const mayBeList = parseSource(node.source).kind === "field" && (read === undefined || Array.isArray(read));
  const showDefault = defaultOpen || node.fallback !== "";

  return (
    <div className="flex flex-col gap-1">
      <div className="grid grid-cols-[minmax(4.5rem,0.8fr)_0.75rem_minmax(6rem,1.4fr)_minmax(0,0.9fr)_auto] items-center gap-1.5">
        <Input
          aria-label={`Name of ${name}`}
          className="h-8 font-mono text-xs"
          placeholder="name"
          value={node.key}
          onChange={(e) => onChange({ key: e.target.value })}
        />
        <ArrowLeftIcon aria-hidden className="size-3.5 text-muted-foreground" />
        <Input
          aria-label={`Source of ${name}`}
          title="A message field such as value.id, fixed text or a number, or text with {{placeholders}}"
          list={SOURCE_LIST}
          className={cn("h-8 font-mono text-xs", dropping && "border-primary ring-3 ring-primary/30")}
          placeholder="value.id"
          value={node.source}
          onChange={(e) => onChange({ source: e.target.value })}
          {...drop}
        />
        {Array.isArray(read) && mayBeList && node.transform === null ? (
          <button
            type="button"
            onClick={onMapEach}
            aria-label={`Map each item of ${name}`}
            className="flex min-w-0 items-center gap-1 rounded px-1 text-xs text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <RepeatIcon aria-hidden className="size-3 shrink-0" />
            <span className="truncate">Map each ({read.length})</span>
          </button>
        ) : (
          <span className="truncate font-mono text-xs text-muted-foreground" title={describeValue(sent)}>
            {describeValue(sent)}
          </span>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon-sm" aria-label={`More for ${name}`}>
              <EllipsisIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Convert</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup
                  value={node.transform ?? AS_IS}
                  onValueChange={(t) => onChange({ transform: t === AS_IS ? null : (t as Transform) })}
                >
                  <DropdownMenuRadioItem value={AS_IS}>As is</DropdownMenuRadioItem>
                  {TRANSFORMS.map((t) => (
                    <DropdownMenuRadioItem key={t} value={t}>
                      {TRANSFORM_LABELS[t]}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem onSelect={() => onOpenDefault(true)}>If missing, send…</DropdownMenuItem>
            {mayBeList && (
              <DropdownMenuItem onSelect={onMapEach}>
                <RepeatIcon /> Map each item
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={onRemove}>
              <Trash2Icon /> Remove
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {(node.transform !== null || showDefault) && (
        <div className="ml-1 flex flex-wrap items-center gap-x-3 gap-y-1 border-l-2 pl-3 text-xs text-muted-foreground">
          {node.transform !== null && (
            <span className="flex items-center gap-1">
              → {TRANSFORM_LABELS[node.transform]}
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={`Stop converting ${name}`}
                onClick={() => onChange({ transform: null })}
              >
                <XIcon />
              </Button>
            </span>
          )}
          {showDefault && (
            <label className="flex items-center gap-1.5">
              if missing
              <Input
                aria-label={`Default of ${name}`}
                className="h-6 w-28 font-mono text-xs"
                placeholder="null"
                value={node.fallback}
                onChange={(e) => onChange({ fallback: e.target.value })}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={`No default for ${name}`}
                onClick={() => {
                  onChange({ fallback: "" });
                  onOpenDefault(false);
                }}
              >
                <XIcon />
              </Button>
            </label>
          )}
        </div>
      )}
    </div>
  );
}

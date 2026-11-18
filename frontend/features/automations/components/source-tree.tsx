import { ChevronRightIcon, SearchIcon } from "lucide-react";
import { useState } from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { describeValue, type FieldNode } from "../sample-fields";

export const FIELD_DRAG = "application/x-kui-field";
const MAX_MATCHES = 100;
/** Below this many fields, a filter box is only clutter. */
const FILTER_FROM = 15;

const flatten = (nodes: FieldNode[]): FieldNode[] => nodes.flatMap((n) => [n, ...flatten(n.children)]);

interface SourceTreeProps {
  roots: FieldNode[];
  onPick: (path: string) => void;
}

/** The sample message's fields with their values. Click one to add it, or drag it where it should go. */
export function SourceTree({ roots, onPick }: SourceTreeProps) {
  const [filter, setFilter] = useState("");
  // Top-level fields start open, deeper ones closed; this holds the ones flipped from that.
  const [flipped, setFlipped] = useState<ReadonlySet<string>>(() => new Set());
  const all = flatten(roots);
  const term = filter.trim().toLowerCase();
  const matches = term ? all.filter((n) => n.path.toLowerCase().includes(term)).slice(0, MAX_MATCHES) : null;

  const flip = (path: string) =>
    setFlipped((current) => {
      const next = new Set(current);
      if (!next.delete(path)) next.add(path);
      return next;
    });

  const row = (node: FieldNode, depth: number) => {
    const branch = node.children.length > 0 && matches === null;
    const open = branch && (depth === 0) !== flipped.has(node.path);
    return (
      <li key={node.path}>
        <div className="flex min-w-0 items-center" style={{ paddingLeft: depth * 12 }}>
          {branch ? (
            <button
              type="button"
              aria-expanded={open}
              aria-label={`${open ? "Collapse" : "Expand"} ${node.path}`}
              onClick={() => flip(node.path)}
              className="grid size-5 shrink-0 place-items-center rounded text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <ChevronRightIcon className={cn("size-3.5 transition-transform", open && "rotate-90")} />
            </button>
          ) : (
            <span className="size-5 shrink-0" />
          )}
          <button
            type="button"
            draggable
            title={node.path}
            aria-label={`Add ${node.path}`}
            onDragStart={(e) => {
              e.dataTransfer.setData(FIELD_DRAG, node.path);
              e.dataTransfer.effectAllowed = "copy";
            }}
            onClick={() => onPick(node.path)}
            className="flex min-w-0 flex-1 cursor-grab items-baseline gap-2 rounded px-1 py-0.5 text-left font-mono text-xs outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 active:cursor-grabbing"
          >
            <span className="shrink-0">{matches ? node.path : node.name}</span>
            <span className="ml-auto truncate text-muted-foreground">{describeValue(node.value)}</span>
          </button>
        </div>
        {open && <ul>{node.children.map((child) => row(child, depth + 1))}</ul>}
      </li>
    );
  };

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {(all.length >= FILTER_FROM || term) && (
        <div className="relative">
          <SearchIcon aria-hidden className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Filter message fields"
            placeholder="Filter fields"
            className="h-8 pl-7 text-xs"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
      )}
      <ul aria-label="Message fields" className="flex flex-col">
        {(matches ?? roots).map((node) => row(node, 0))}
      </ul>
      {matches?.length === 0 && <p className="text-xs text-muted-foreground">No field matches.</p>}
    </div>
  );
}

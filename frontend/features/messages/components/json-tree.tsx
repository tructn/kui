import { ChevronRightIcon, ChevronsDownUpIcon, ChevronsUpDownIcon, HashIcon } from "lucide-react";
import { Component, createContext, type ReactNode, useContext, useMemo, useRef, useState } from "react";

import { CopyIndicator, useCopy } from "@/components/copy-button";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import {
  describeSize,
  entriesOf,
  type Embedded,
  inspectEmbedded,
  isContainer,
  type JsonContainer,
  type JsonValue,
  parseTree,
} from "../json-tree";

/** Children shown per container before "Show more", so a 10,000-item array doesn't freeze the panel. */
const PAGE_SIZE = 100;
/** Longer strings are cut here until clicked. */
const STRING_CLAMP = 240;
/** Containers at this depth or deeper start collapsed. */
const DEFAULT_OPEN_DEPTH = 2;

/** Whether containers show their size ("3 keys"). */
const ShowCounts = createContext(true);

interface JsonTreeProps {
  /** The payload's text; renders nothing unless it holds a JSON object or array (or a string holding one). */
  text: string;
  className?: string;
}

/**
 * A JSON document as a tree that expands and collapses. A string that holds JSON, however deep
 * in the document, is shown as the object it holds, tagged JSON.
 */
export function JsonTree({ text, className }: JsonTreeProps) {
  const root = useMemo(() => parseTree(text), [text]);
  // Remounting the nodes resets every one to `openDepth`; that's how Expand/Collapse all work.
  const [showCounts, setShowCounts] = useState(true);
  const body = useRef<HTMLDivElement>(null);
  const { copied: copiedSelection, copy } = useCopy();
  const [fold, setFold] = useState({ openDepth: DEFAULT_OPEN_DEPTH, epoch: 0 });
  const foldTo = (openDepth: number) => setFold((f) => ({ openDepth, epoch: f.epoch + 1 }));
  if (!root) return null;

  // Selecting text in the tree copies it, as in a terminal. A plain click leaves no selection.
  const copySelection = () => {
    const selection = window.getSelection();
    const text = selection?.toString();
    if (text && body.current && selection?.anchorNode && body.current.contains(selection.anchorNode)) void copy(text);
  };

  return (
    <div className={cn("flex min-h-0 flex-col overflow-hidden rounded-lg bg-muted", className)}>
      <div className="flex items-center gap-1 border-b border-border/60 px-2 py-1">
        {showCounts && <span className="px-1 font-sans text-xs text-muted-foreground">{describeSize(root)}</span>}
        <div className="flex-1" />
        {copiedSelection && (
          <span className="flex animate-in items-center gap-1 px-1 font-sans text-xs text-muted-foreground duration-200 fade-in-0 slide-in-from-right-1 [&_svg]:size-3">
            <CopyIndicator copied /> Copied selection
          </span>
        )}
        <Button
          variant={showCounts ? "secondary" : "ghost"}
          size="xs"
          aria-pressed={showCounts}
          title="Show how many keys or items each node has"
          onClick={() => setShowCounts(!showCounts)}
        >
          <HashIcon /> Counts
        </Button>
        <Button variant="ghost" size="xs" onClick={() => foldTo(Infinity)}>
          <ChevronsUpDownIcon /> Expand all
        </Button>
        <Button variant="ghost" size="xs" onClick={() => foldTo(1)}>
          <ChevronsDownUpIcon /> Collapse all
        </Button>
      </div>
      <div
        ref={body}
        onMouseUp={copySelection}
        className="min-h-0 flex-1 overflow-auto p-2 font-mono text-code leading-relaxed"
      >
        <ShowCounts.Provider value={showCounts}>
          <Node key={fold.epoch} label={null} value={root} depth={0} openDepth={fold.openDepth} />
        </ShowCounts.Provider>
      </div>
    </div>
  );
}

interface NodeProps {
  /** Object key or array index; null for the root. */
  label: string | number | null;
  value: JsonValue;
  depth: number;
  openDepth: number;
}

/** One entry of the document: an expandable container (or a string holding one), or a plain value. */
function Node({ label, value, depth, openDepth }: NodeProps) {
  // Parsed here, once per value, so a big JSON string costs nothing until its row is rendered.
  const embedded = useMemo<Embedded>(
    () => (typeof value === "string" ? inspectEmbedded(value) : { kind: "text" }),
    [value],
  );
  const container = embedded.kind === "json" ? embedded.value : isContainer(value) ? value : undefined;
  return container ? (
    <ContainerNode
      label={label}
      container={container}
      isEmbedded={embedded.kind === "json"}
      depth={depth}
      openDepth={openDepth}
    />
  ) : (
    <LeafNode label={label} value={value} error={embedded.kind === "broken" ? embedded.error : undefined} />
  );
}

function ContainerNode({
  label,
  container,
  isEmbedded,
  depth,
  openDepth,
}: Omit<NodeProps, "value"> & { container: JsonContainer; isEmbedded: boolean }) {
  const [open, setOpen] = useState(depth < openDepth);
  // Children mount on first open and stay, so collapsing can animate them away.
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(PAGE_SIZE);
  const entries = useMemo(() => (mounted ? entriesOf(container) : []), [mounted, container]);
  const isArray = Array.isArray(container);
  const showCounts = useContext(ShowCounts);

  const toggle = () => {
    setMounted(true);
    setOpen(!open);
  };
  const remaining = entries.length - visible;

  return (
    <div>
      <Row
        lead={
          // Not a <button>: WebKit can't select text inside one. The chevron is the keyboard target.
          <div
            onClick={() => {
              // Dragging across the row to select its text ends in a click; that shouldn't fold it.
              if (!window.getSelection()?.toString()) toggle();
            }}
            className="flex min-w-0 flex-1 cursor-pointer items-baseline gap-1 rounded select-text"
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                toggle();
              }}
              aria-expanded={open}
              aria-label={open ? "Collapse" : "Expand"}
              className="shrink-0 rounded outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
            >
              <ChevronRightIcon
                className={cn(
                  "size-3.5 translate-y-0.5 text-muted-foreground transition-transform duration-200",
                  open && "rotate-90 text-primary",
                )}
              />
            </button>
            <Label label={label} />
            <span className="text-json-punct">{isArray ? "[" : "{"}</span>
            {isEmbedded && <JsonBadge />}
            {open ? (
              showCounts && <span className="px-1 font-sans text-xs text-muted-foreground">{describeSize(container)}</span>
            ) : (
              <span className="min-w-0 truncate text-muted-foreground">
                {preview(container, showCounts)}
                <span className="text-json-punct">{isArray ? "]" : "}"}</span>
              </span>
            )}
          </div>
        }
      />
      {/* 0fr -> 1fr animates to the content's own height, which a plain height transition can't. */}
      <div
        inert={!open}
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-200 ease-out",
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="min-h-0 overflow-hidden">
          {mounted && (
            <div className="ml-[0.45rem] border-l border-border pl-3 transition-colors hover:border-primary/50">
              {entries.slice(0, visible).map(([key, child], i) => (
                <div
                  key={key}
                  className="animate-in duration-200 fill-mode-backwards fade-in-0 slide-in-from-top-1"
                  style={{ animationDelay: `${Math.min(i, 12) * 18}ms` }}
                >
                  <Node label={key} value={child} depth={depth + 1} openDepth={openDepth} />
                </div>
              ))}
              {remaining > 0 && (
                <Button variant="ghost" size="xs" className="my-0.5" onClick={() => setVisible((v) => v + PAGE_SIZE)}>
                  Show {Math.min(PAGE_SIZE, remaining)} more · {remaining} left
                </Button>
              )}
              <span className="text-json-punct">{isArray ? "]" : "}"}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** A plain value. `error` is set for a string that looks like JSON but couldn't be parsed. */
function LeafNode({ label, value, error }: { label: string | number | null; value: JsonValue; error?: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <Row
      lead={
        <div className="flex min-w-0 flex-1 items-baseline gap-1">
          <span className="size-3.5 shrink-0" />
          <Label label={label} />
          {error != null && <InvalidJsonBadge error={error} />}
          {typeof value === "string" ? (
            <span className="min-w-0 text-json-string break-all whitespace-pre-wrap">
              "{expanded || value.length <= STRING_CLAMP ? value : value.slice(0, STRING_CLAMP)}"
              {value.length > STRING_CLAMP && (
                <button
                  type="button"
                  onClick={() => setExpanded(!expanded)}
                  className="ml-1 rounded font-sans text-xs text-primary underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/60"
                >
                  {expanded ? "less" : `+${value.length - STRING_CLAMP} more`}
                </button>
              )}
            </span>
          ) : (
            <span
              className={cn(
                typeof value === "number" && "text-json-number",
                typeof value === "boolean" && "text-json-boolean",
                value === null && "text-json-null italic",
              )}
            >
              {String(value)}
            </span>
          )}
        </div>
      }
    />
  );
}

/** A tree line, highlighted on hover. */
function Row({ lead }: { lead: React.ReactNode }) {
  return <div className="flex items-start gap-1 rounded-md px-1 transition-colors hover:bg-accent">{lead}</div>;
}

function Label({ label }: { label: string | number | null }) {
  if (label == null) return null;
  return (
    <>
      {typeof label === "number" ? (
        <span className="text-json-null">{label}</span>
      ) : (
        <span className="text-json-key">"{label}"</span>
      )}
      <span className="text-json-punct">:</span>
    </>
  );
}

/** Marks a string whose text is JSON that the tree has parsed. */
function JsonBadge() {
  return (
    <span
      title="This string holds JSON, shown parsed."
      className="rounded bg-primary/15 px-1 font-sans text-[0.65rem] leading-4 font-medium tracking-wide text-primary uppercase"
    >
      json
    </span>
  );
}

/** Marks a string that looks like JSON but doesn't parse; it is shown as the text it is. */
function InvalidJsonBadge({ error }: { error: string }) {
  return (
    <span
      title={`Looks like JSON but can't be parsed: ${error}`}
      className="rounded bg-destructive/15 px-1 font-sans text-[0.65rem] leading-4 font-medium tracking-wide text-destructive uppercase"
    >
      invalid json
    </span>
  );
}

/**
 * Keeps a failure while drawing the tree (a document nested thousands of levels deep overflows the
 * stack) from taking the panel down: shows `fallback` instead.
 */
export class JsonTreeBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** A collapsed container's contents: its first keys, or an array's size, e.g. `sku, name, price, … }`. */
function preview(container: JsonContainer, showCounts: boolean): string {
  if (Array.isArray(container)) return showCounts ? ` ${describeSize(container)} ` : " … ";
  const keys = Object.keys(container);
  const shown = keys.slice(0, 4).join(", ");
  return keys.length === 0 ? " " : ` ${shown}${keys.length > 4 ? ", …" : ""} `;
}

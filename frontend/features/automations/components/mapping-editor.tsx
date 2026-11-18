import { BracesIcon, ChevronDownIcon, PlusIcon, RepeatIcon, Trash2Icon, XIcon } from "lucide-react";
import { useState, type DragEvent, type ReactNode, type SyntheticEvent } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import {
  appendNode,
  childrenOf,
  fromFields,
  newGroup,
  newList,
  newValue,
  pathTo,
  removeNode,
  toFields,
  updateNode,
  type ContainerNode,
  type MapNode,
} from "../mapping-tree";
import {
  describeValue,
  fieldTree,
  keyFor,
  resolvePath,
  withItem,
  type FieldNode,
  type SampleContext,
} from "../sample-fields";
import type { FieldMapping } from "../types";
import { FIELD_DRAG, SourceTree } from "./source-tree";
import { SOURCE_LIST, ValueRow, type DropTarget } from "./value-row";

const TOP = "top";

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const isFieldDrag = (e: DragEvent) => e.dataTransfer.types.includes(FIELD_DRAG);
const flatten = (nodes: FieldNode[]): FieldNode[] => nodes.flatMap((n) => [n, ...flatten(n.children)]);

interface MappingEditorProps {
  fields: FieldMapping[];
  onChange: (fields: FieldMapping[]) => void;
  context: SampleContext;
  /** The list a request is sent per item of: `item` can then be read everywhere. */
  split: string | null;
  /** The body the preview built for the sample, to show what each field sends. */
  sent: unknown;
}

/**
 * The sample's fields on the left, the message to send on the right, nested like the JSON it
 * builds. A picked field goes into the selected group or list; a list maps every item of an array.
 */
export function MappingEditor({ fields, onChange, context, split, sent }: MappingEditorProps) {
  const [nodes, setNodes] = useState(() => fromFields(fields));
  const [selected, setSelected] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [defaultsOpen, setDefaultsOpen] = useState<ReadonlySet<string>>(() => new Set());

  // The selection may have been removed; then fields go to the top level.
  const chain = pathTo(nodes, selected);
  const target = chain.at(-1) ?? null;
  const parent = target?.id ?? null;
  const lists = [split ?? "", ...chain.map((n) => (n.kind === "list" ? n.path : ""))].map((p) => p.trim()).filter(Boolean);
  const roots = fieldTree(withItem(context, lists), lists.length > 0);
  const topScope = split ? withItem(context, [split]) : context;

  function commit(next: MapNode[]) {
    setNodes(next);
    onChange(toFields(next));
  }
  const change = (id: string, patch: (node: MapNode) => MapNode) => commit(updateNode(nodes, id, patch));
  const siblingKeys = (container: string | null) => childrenOf(nodes, container).map((n) => n.key.trim());

  function addField(container: string | null, path: string) {
    commit(appendNode(nodes, container, newValue(keyFor(path, siblingKeys(container)), path)));
  }
  function addNode(kind: MapNode["kind"]) {
    const node =
      kind === "value"
        ? newValue("")
        : kind === "group"
          ? newGroup(keyFor("group", siblingKeys(parent)))
          : newList(keyFor("items", siblingKeys(parent)), "");
    commit(appendNode(nodes, parent, node));
    if (kind !== "value") setSelected(node.id);
  }
  function mapEach(node: Extract<MapNode, { kind: "value" }>) {
    change(node.id, () => ({ ...newList(node.key, node.source.trim()), id: node.id }));
    setSelected(node.id);
  }
  const openDefault = (id: string, open: boolean) =>
    setDefaultsOpen((current) => {
      const next = new Set(current);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });

  const dropTarget = (key: string, onField: (path: string) => void): DropTarget => ({
    onDragOver: (e) => {
      if (!isFieldDrag(e)) return;
      e.preventDefault();
      e.stopPropagation();
      setOver(key);
    },
    onDragLeave: (e) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver((o) => (o === key ? null : o));
    },
    onDrop: (e) => {
      if (!isFieldDrag(e)) return;
      e.preventDefault();
      e.stopPropagation();
      setOver(null);
      const path = e.dataTransfer.getData(FIELD_DRAG);
      if (path) onField(path);
    },
  });
  /**
   * Pressing or focusing inside a container selects it; the innermost one wins. Not `onClick`: it
   * would run after a button's own click and undo the selection that button made.
   */
  const selects = (id: string | null) => {
    const select = (e: SyntheticEvent) => {
      e.stopPropagation();
      setSelected(id);
    };
    return { onFocus: select, onPointerDown: select };
  };

  /** `scope` is the sample as the nodes read it, with `item` set inside a list. */
  const renderNodes = (list: readonly MapNode[], out: unknown, scope: SampleContext): ReactNode =>
    list.map((node) => {
      const value = isRecord(out) ? out[node.key.trim()] : undefined;
      return node.kind === "value" ? (
        <ValueRow
          key={node.id}
          node={node}
          sent={value}
          read={resolvePath(node.source, scope)}
          defaultOpen={defaultsOpen.has(node.id)}
          onOpenDefault={(open) => openDefault(node.id, open)}
          onChange={(patch) => change(node.id, (n) => ({ ...n, ...patch }) as MapNode)}
          onRemove={() => commit(removeNode(nodes, node.id))}
          onMapEach={() => mapEach(node)}
          drop={dropTarget(node.id, (path) => change(node.id, (n) => ({ ...n, source: path }) as MapNode))}
          dropping={over === node.id}
        />
      ) : (
        renderContainer(node, value, scope)
      );
    });

  const renderContainer = (node: ContainerNode, value: unknown, scope: SampleContext) => {
    const name = node.key.trim() || (node.kind === "list" ? "new list" : "new group");
    const items = node.kind === "list" && Array.isArray(value) ? value : undefined;
    return (
      <div
        key={node.id}
        role="group"
        aria-label={node.kind === "list" ? `List ${name}` : `Group ${name}`}
        {...selects(node.id)}
        {...dropTarget(node.id, (path) => addField(node.id, path))}
        className={cn("flex flex-col gap-1 rounded-md transition-colors", over === node.id && "bg-primary/5")}
      >
        <div className="flex min-w-0 items-center gap-1.5">
          <Input
            aria-label={`Name of ${name}`}
            className="h-8 w-32 shrink-0 font-mono text-xs"
            placeholder="name"
            value={node.key}
            onChange={(e) => change(node.id, (n) => ({ ...n, key: e.target.value }))}
          />
          {node.kind === "group" ? (
            <BracesIcon aria-label="group" className="size-3.5 text-muted-foreground" />
          ) : (
            <>
              <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                <RepeatIcon aria-hidden className="size-3" /> each item of
              </span>
              <Input
                aria-label={`List that ${name} maps`}
                list={SOURCE_LIST}
                className="h-8 min-w-0 flex-1 font-mono text-xs"
                placeholder="value.items"
                value={node.path}
                onChange={(e) => change(node.id, (n) => (n.kind === "list" ? { ...n, path: e.target.value } : n))}
              />
              {items && <span className="shrink-0 text-xs text-muted-foreground">{describeValue(items)}</span>}
            </>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="ml-auto"
            aria-label={`Remove ${name}`}
            onClick={() => commit(removeNode(nodes, node.id))}
          >
            <Trash2Icon />
          </Button>
        </div>
        <div
          className={cn(
            "ml-3 flex flex-col gap-1 border-l-2 py-0.5 pl-3 transition-colors",
            target?.id === node.id ? "border-primary" : "border-border",
          )}
        >
          {node.kind === "list"
            ? renderNodes(node.children, items?.[0], withItem(scope, [node.path.trim()]))
            : renderNodes(node.children, value, scope)}
          {node.children.length === 0 && (
            <p className="py-1 text-xs text-muted-foreground">
              {node.kind === "list" ? "Pick the fields of each item on the left." : "Pick fields on the left."}
            </p>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="grid min-w-0 gap-4 md:grid-cols-[14rem_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-3 md:max-h-[34rem] md:overflow-y-auto md:pr-1">
        <SourceTree roots={roots} onPick={(path) => addField(parent, path)} />
      </div>

      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex min-h-8 items-center gap-2">
          <p className="text-xs font-medium">Message to send</p>
          {target && (
            <span className="flex min-w-0 items-center gap-0.5 text-xs text-muted-foreground">
              <span className="truncate">
                · adding to <span className="font-mono text-foreground">{target.key.trim() || "new " + target.kind}</span>
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label="Add to the top level instead"
                onClick={() => setSelected(null)}
              >
                <XIcon />
              </Button>
            </span>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" size="xs" className="ml-auto">
                <PlusIcon /> Add <ChevronDownIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => addNode("value")}>
                <PlusIcon /> Field
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => addNode("group")}>
                <BracesIcon /> Group
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => addNode("list")}>
                <RepeatIcon /> List, item by item
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div
          {...selects(null)}
          {...dropTarget(TOP, (path) => addField(null, path))}
          className={cn(
            "flex min-h-24 min-w-0 flex-col gap-1.5 rounded-lg border border-dashed p-3 transition-colors",
            over === TOP && "border-primary bg-primary/5",
          )}
        >
          {nodes.length === 0 && (
            <p className="m-auto text-center text-sm text-muted-foreground">Click or drag fields from the left.</p>
          )}
          {renderNodes(nodes, sent, topScope)}
        </div>
        <datalist id={SOURCE_LIST}>
          {flatten(roots).map((f) => (
            <option key={f.path} value={f.path} />
          ))}
        </datalist>
      </div>
    </div>
  );
}

import { formatLooseValue, parseLooseValue } from "@/lib/loose-value";

import { formatSource, parseSource } from "./source";
import type { FieldMapping, Transform } from "./types";

/**
 * The body being built, as the editor shows it: nested like the JSON it sends. The saved form is
 * a flat list of dotted targets (`customer.name`), so a group is only a shared prefix.
 */
export type MapNode =
  /** `source` and `fallback` are kept as typed, so `true ` on the way to `true love` isn't undone. */
  | { kind: "value"; id: string; key: string; source: string; transform: Transform | null; fallback: string }
  | { kind: "group"; id: string; key: string; children: MapNode[] }
  | { kind: "list"; id: string; key: string; path: string; children: MapNode[] };

export type ContainerNode = Extract<MapNode, { children: MapNode[] }>;

let nextId = 0;
const newId = () => `n${nextId++}`;

export const newValue = (key: string, source = ""): MapNode => ({
  kind: "value",
  id: newId(),
  key,
  source,
  transform: null,
  fallback: "",
});
export const newGroup = (key: string): ContainerNode => ({ kind: "group", id: newId(), key, children: [] });
export const newList = (key: string, path: string): ContainerNode => ({ kind: "list", id: newId(), key, path, children: [] });

export function fromFields(fields: readonly FieldMapping[]): MapNode[] {
  const root: MapNode[] = [];
  for (const field of fields) {
    const parts = field.target.split(".");
    const key = parts.pop() ?? "";
    let level = root;
    for (const part of parts) {
      let group = level.find((n): n is ContainerNode => n.kind === "group" && n.key === part);
      if (!group) {
        group = { kind: "group", id: newId(), key: part, children: [] };
        level.push(group);
      }
      level = group.children;
    }
    level.push(
      field.source.kind === "each"
        ? { ...newList(key, field.source.path), children: fromFields(field.source.fields) }
        : {
            kind: "value",
            id: newId(),
            key,
            source: formatSource(field.source),
            transform: field.transform,
            fallback: formatLooseValue(field.default),
          },
    );
  }
  return root;
}

/** The saved form. A row left completely blank, or an empty group, is dropped instead of being an error. */
export function toFields(nodes: readonly MapNode[], prefix = ""): FieldMapping[] {
  return nodes.flatMap((node): FieldMapping[] => {
    const target = prefix + node.key.trim();
    switch (node.kind) {
      case "value":
        if (node.key.trim() === "" && node.source.trim() === "") return [];
        return [
          {
            target,
            source: parseSource(node.source),
            transform: node.transform,
            default: node.fallback.trim() === "" ? null : parseLooseValue(node.fallback),
          },
        ];
      case "group":
        return toFields(node.children, `${target}.`);
      case "list":
        return [
          {
            target,
            source: { kind: "each", path: node.path.trim(), fields: toFields(node.children) },
            transform: null,
            default: null,
          },
        ];
    }
  });
}

export const isContainer = (node: MapNode): node is ContainerNode => node.kind !== "value";

export function updateNode(nodes: readonly MapNode[], id: string, change: (node: MapNode) => MapNode): MapNode[] {
  return nodes.map((node) => {
    if (node.id === id) return change(node);
    return isContainer(node) ? { ...node, children: updateNode(node.children, id, change) } : node;
  });
}

export function removeNode(nodes: readonly MapNode[], id: string): MapNode[] {
  return nodes
    .filter((node) => node.id !== id)
    .map((node) => (isContainer(node) ? { ...node, children: removeNode(node.children, id) } : node));
}

/** Adds `child` at the end of the container `parent`, or of the top level when it is null. */
export function appendNode(nodes: readonly MapNode[], parent: string | null, child: MapNode): MapNode[] {
  if (parent === null) return [...nodes, child];
  return updateNode(nodes, parent, (node) => (isContainer(node) ? { ...node, children: [...node.children, child] } : node));
}

/** The containers from the top level down to `id`, including it; empty when it isn't there. */
export function pathTo(nodes: readonly MapNode[], id: string | null): ContainerNode[] {
  if (id === null) return [];
  for (const node of nodes) {
    if (!isContainer(node)) continue;
    if (node.id === id) return [node];
    const below = pathTo(node.children, id);
    if (below.length > 0) return [node, ...below];
  }
  return [];
}

/** The children of container `id`, or the top level when it is null. */
export function childrenOf(nodes: readonly MapNode[], id: string | null): readonly MapNode[] {
  return id === null ? nodes : (pathTo(nodes, id).at(-1)?.children ?? nodes);
}

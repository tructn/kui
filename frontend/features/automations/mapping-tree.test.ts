import { describe, expect, it } from "bun:test";

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
  type MapNode,
} from "./mapping-tree";
import type { FieldMapping } from "./types";

const field = (target: string, path: string): FieldMapping => ({
  target,
  source: { kind: "field", path },
  transform: null,
  default: null,
});

describe("fromFields / toFields", () => {
  it("nests dotted targets into groups and back", () => {
    const fields: FieldMapping[] = [
      field("order.id", "value.id"),
      field("order.total", "value.total"),
      { ...field("status", "value.status"), transform: "upper", default: "new" },
      {
        target: "lines",
        source: { kind: "each", path: "value.items", fields: [field("sku", "item.sku"), field("meta.order", "value.id")] },
        transform: null,
        default: null,
      },
    ];
    const nodes = fromFields(fields);
    expect(nodes.map((n) => `${n.kind}:${n.key}`)).toEqual(["group:order", "value:status", "list:lines"]);
    const lines = nodes[2];
    expect(lines?.kind === "list" && lines.children.map((n) => n.key)).toEqual(["sku", "meta"]);
    expect(toFields(nodes)).toEqual(fields);
  });

  it("drops blank rows and empty groups", () => {
    const nodes = [newValue(""), newGroup("empty"), newValue("a", "key")];
    expect(toFields(nodes)).toEqual([field("a", "key")]);
  });

  it("keeps a fixed value and a template as typed", () => {
    const nodes = [newValue("source", "kafka"), newValue("text", "{{key}}!")];
    expect(toFields(nodes).map((f) => f.source)).toEqual([
      { kind: "fixed", value: "kafka" },
      { kind: "template", text: "{{key}}!" },
    ]);
  });
});

describe("tree edits", () => {
  const tree = (): { nodes: MapNode[]; list: MapNode; inner: MapNode } => {
    const inner = newValue("sku", "item.sku");
    const list = { ...newList("lines", "value.items"), children: [inner] };
    return { nodes: [newValue("id", "value.id"), { ...newGroup("meta"), children: [list] }], list, inner };
  };

  it("finds the containers down to a node", () => {
    const { nodes, list } = tree();
    expect(pathTo(nodes, list.id).map((n) => n.key)).toEqual(["meta", "lines"]);
    expect(pathTo(nodes, null)).toEqual([]);
    expect(childrenOf(nodes, list.id).map((n) => n.key)).toEqual(["sku"]);
  });

  it("adds, changes and removes nested nodes", () => {
    const { nodes, list, inner } = tree();
    const added = appendNode(nodes, list.id, newValue("qty", "item.qty"));
    expect(childrenOf(added, list.id).map((n) => n.key)).toEqual(["sku", "qty"]);
    const renamed = updateNode(added, inner.id, (n) => ({ ...n, key: "code" }));
    expect(childrenOf(renamed, list.id).map((n) => n.key)).toEqual(["code", "qty"]);
    expect(childrenOf(removeNode(renamed, inner.id), list.id).map((n) => n.key)).toEqual(["qty"]);
    expect(toFields(renamed)[1]?.target).toBe("meta.lines");
  });
});

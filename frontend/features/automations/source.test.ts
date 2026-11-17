import { describe, expect, it } from "bun:test";

import { formatSource, parseSource } from "./source";

describe("parseSource", () => {
  it("recognises message fields, templates and fixed values", () => {
    expect(parseSource("value.customer.name")).toEqual({ kind: "field", path: "value.customer.name" });
    expect(parseSource("headers.x-source")).toEqual({ kind: "field", path: "headers.x-source" });
    expect(parseSource("topic")).toEqual({ kind: "field", path: "topic" });
    expect(parseSource("{{key}} from {{topic}}")).toEqual({ kind: "template", text: "{{key}} from {{topic}}" });
    expect(parseSource("kafka")).toEqual({ kind: "fixed", value: "kafka" });
    expect(parseSource("42")).toEqual({ kind: "fixed", value: 42 });
    expect(parseSource("true")).toEqual({ kind: "fixed", value: true });
  });

  it("does not take a word that merely starts like a root for a field", () => {
    expect(parseSource("values")).toEqual({ kind: "fixed", value: "values" });
    expect(parseSource("keyboard")).toEqual({ kind: "fixed", value: "keyboard" });
  });

  it("lets quotes force a fixed text", () => {
    expect(parseSource('"value.id"')).toEqual({ kind: "fixed", value: "value.id" });
  });
});

describe("formatSource", () => {
  it("round-trips every kind of source", () => {
    for (const text of ["value.id", "{{key}}-x", "kafka", "42", "true", '"value.id"', '"{{x}}"', '"42"']) {
      expect(formatSource(parseSource(text))).toBe(text);
    }
  });
});

import { describe, expect, test } from "bun:test";

import { tokenizeTemplate } from "./template-tokens";

function kinds(text: string) {
  return tokenizeTemplate(text).map((t) => [t.kind, text.slice(t.from, t.to)]);
}

describe("tokenizeTemplate", () => {
  test("tells keys from string values and finds bare placeholders", () => {
    expect(kinds('{"id": {{seq}}, "ok": true}')).toEqual([
      ["punct", "{"],
      ["key", '"id"'],
      ["punct", ":"],
      ["placeholder", "{{seq}}"],
      ["punct", ","],
      ["key", '"ok"'],
      ["punct", ":"],
      ["literal", "true"],
      ["punct", "}"],
    ]);
  });

  test("splits placeholders out of strings", () => {
    expect(kinds('"order-{{int 1 9}} x"')).toEqual([
      ["string", '"order-'],
      ["placeholder", "{{int 1 9}}"],
      ["string", ' x"'],
    ]);
  });

  test("keeps escaped quotes inside a string and reads numbers", () => {
    expect(kinds('"a\\"b" -1.5e3')).toEqual([
      ["string", '"a\\"b"'],
      ["number", "-1.5e3"],
    ]);
  });

  test("survives unclosed placeholders and strings", () => {
    expect(kinds('"abc\n{{uuid')).toEqual([
      ["string", '"abc'],
      ["placeholder", "{{uuid"],
    ]);
  });
});

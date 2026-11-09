import { describe, expect, test } from "bun:test";

import { payloadViews, renderPayload, truncationNotice } from "./payload-view";
import type { Payload } from "./types";

const utf8 = (text: string): Payload => ({ text, encoding: "utf8", size: new TextEncoder().encode(text).length });
const binary: Payload = { text: "00 ff 10", encoding: "hex", size: 3 };

describe("renderPayload", () => {
  test("json pretty-prints JSON and leaves other text as is", () => {
    expect(renderPayload(utf8('{"a":1}'), "json")).toBe('{\n  "a": 1\n}');
    expect(renderPayload(utf8("plain"), "json")).toBe("plain");
  });

  test("base64 encodes the original bytes, not the pretty-printed text", () => {
    expect(renderPayload(utf8('{"a":1}'), "base64")).toBe(btoa('{"a":1}'));
    expect(renderPayload(utf8("héllo"), "base64")).toBe("aMOpbGxv");
    expect(renderPayload(binary, "base64")).toBe("AP8Q");
  });

  test("binary has no json view and falls back to base64", () => {
    expect(payloadViews(utf8("x"))).toEqual(["json", "base64"]);
    expect(payloadViews(binary)).toEqual(["base64"]);
    expect(renderPayload(binary, "json")).toBe("AP8Q");
  });

  test("tree view only for JSON objects, arrays and strings holding them", () => {
    expect(payloadViews(utf8('{"a":1}'))).toEqual(["json", "tree", "base64"]);
    expect(payloadViews(utf8("[1]"))).toEqual(["json", "tree", "base64"]);
    expect(payloadViews(utf8(JSON.stringify('{"a":1}')))).toEqual(["json", "tree", "base64"]);
    for (const text of ["42", '"hi"', "INFO ok", ""]) expect(payloadViews(utf8(text))).toEqual(["json", "base64"]);
    expect(payloadViews(binary)).toEqual(["base64"]);
  });

  test("tree view copies as the pretty-printed JSON", () => {
    expect(renderPayload(utf8('{"a":1}'), "tree")).toBe('{\n  "a": 1\n}');
  });

  test("large payloads encode without overflowing the call stack", () => {
    const big = "x".repeat(200_000);
    expect(renderPayload(utf8(big), "base64")).toBe(btoa(big));
  });

  test("empty payload", () => {
    expect(renderPayload(utf8(""), "base64")).toBe("");
  });
});

describe("truncated payloads", () => {
  const cut: Payload = { text: '{"a":1', encoding: "utf8", size: 5000, truncated: true };

  test("no tree view, since the prefix is not the document", () => {
    expect(payloadViews(cut)).toEqual(["json", "base64"]);
    expect(payloadViews({ ...cut, text: "[1]" })).toEqual(["json", "base64"]);
  });

  test("notice states shown and total bytes", () => {
    expect(truncationNotice(cut)).toBe("Truncated: showing 6 B of 4.9 KB");
    expect(truncationNotice({ text: "00 ff", encoding: "hex", size: 4096, truncated: true })).toBe(
      "Truncated: showing 2 B of 4.0 KB",
    );
  });

  test("complete payloads have no notice", () => {
    expect(truncationNotice(utf8("x"))).toBeNull();
    expect(truncationNotice({ ...utf8("x"), truncated: false })).toBeNull();
  });
});

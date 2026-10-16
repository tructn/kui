import { describe, expect, test } from "bun:test";

import { payloadPreview, payloadViews, renderPayload, textViewLabel } from "./payload-view";
import type { Payload, PayloadFormat } from "./types";

const base = { decoded: null, schemaId: null, note: null };
const utf8 = (text: string, format: PayloadFormat = "json"): Payload => ({
  ...base,
  text,
  encoding: "utf8",
  format,
  size: new TextEncoder().encode(text).length,
});
const binary: Payload = { ...base, text: "00 ff 10", encoding: "hex", format: "binary", size: 3 };
const avro: Payload = { ...binary, format: "avro", schemaId: 1, decoded: '{"a":1}' };

describe("renderPayload", () => {
  test("text pretty-prints JSON", () => {
    expect(renderPayload(utf8('{"a":1}'), "text")).toBe('{\n  "a": 1\n}');
  });

  test("base64 encodes the original bytes, not the pretty-printed text", () => {
    expect(renderPayload(utf8('{"a":1}'), "base64")).toBe(btoa('{"a":1}'));
    expect(renderPayload(utf8("héllo"), "base64")).toBe("aMOpbGxv");
    expect(renderPayload(binary, "base64")).toBe("AP8Q");
  });

  test("hex of UTF-8 text uses its bytes", () => {
    expect(renderPayload(utf8("hé"), "hex")).toBe("68 c3 a9");
    expect(renderPayload(binary, "hex")).toBe("00 ff 10");
  });

  test("binary has no text view and falls back to hex", () => {
    expect(payloadViews(binary)).toEqual(["hex", "base64"]);
    expect(renderPayload(binary, "text")).toBe("00 ff 10");
  });

  test("large payloads encode without overflowing the call stack", () => {
    const big = "x".repeat(200_000);
    expect(renderPayload(utf8(big), "base64")).toBe(btoa(big));
  });

  test("empty payload", () => {
    expect(renderPayload(utf8(""), "base64")).toBe("");
  });
});

describe("formats", () => {
  test("XML is indented, plain text is left alone", () => {
    expect(renderPayload(utf8("<a><b>x</b></a>", "xml"), "text")).toBe("<a>\n  <b>x</b>\n</a>");
    expect(renderPayload(utf8('{"a":1}', "text"), "text")).toBe('{"a":1}');
  });

  test("decoded payloads show pretty JSON as text, raw bytes as hex", () => {
    expect(payloadViews(avro)).toEqual(["text", "hex", "base64"]);
    expect(textViewLabel(avro)).toBe("Decoded");
    expect(renderPayload(avro, "text")).toBe('{\n  "a": 1\n}');
    expect(renderPayload(avro, "hex")).toBe("00 ff 10");
    expect(payloadPreview(avro)).toBe('{"a":1}');
    expect(payloadPreview(binary)).toBe("00 ff 10");
  });
});

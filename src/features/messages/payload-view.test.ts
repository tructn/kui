import { describe, expect, test } from "bun:test";

import { payloadViews, renderPayload } from "./payload-view";
import type { Payload } from "./types";

const utf8 = (text: string): Payload => ({ text, encoding: "utf8", size: new TextEncoder().encode(text).length });
const binary: Payload = { text: "00 ff 10", encoding: "hex", size: 3 };

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

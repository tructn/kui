import { describe, expect, test } from "bun:test";

import { payloadViews, renderPayload } from "./payload-view";
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

  test("large payloads encode without overflowing the call stack", () => {
    const big = "x".repeat(200_000);
    expect(renderPayload(utf8(big), "base64")).toBe(btoa(big));
  });

  test("empty payload", () => {
    expect(renderPayload(utf8(""), "base64")).toBe("");
  });
});

import { describe, expect, test } from "bun:test";

import { maskAddress, maskClusterName, maskPort } from "./mask";

describe("maskAddress", () => {
  test("returns the value when not hidden", () => {
    expect(maskAddress("broker-1:9092", false)).toBe("broker-1:9092");
  });

  test("hides it behind a stable fake", () => {
    const masked = maskAddress("broker-1:9092", true);
    expect(masked).not.toContain("broker-1");
    expect(maskAddress("broker-1:9092", true)).toBe(masked);
  });

  test("the fake doesn't track the real length", () => {
    const lengths = new Set(["a", "ab", "abc", "abcd", "abcde"].map((v) => maskAddress(v, true).length));
    expect(lengths.size).toBeGreaterThan(1);
    expect(maskAddress("x".repeat(500), true).length).toBeLessThan(40);
  });
});

describe("maskPort", () => {
  test("returns the port when not hidden", () => {
    expect(maskPort(9092, false)).toBe("9092");
  });

  test("hides it", () => {
    expect(maskPort(9092, true)).not.toBe("9092");
  });
});

describe("maskClusterName", () => {
  test("returns the name when not hidden", () => {
    expect(maskClusterName("prod", 0, false)).toBe("prod");
  });

  test("never shows the real name", () => {
    expect(maskClusterName("prod", 0, true)).not.toContain("prod");
  });

  test("keeps every position distinct, even past the end of the list", () => {
    const names = Array.from({ length: 25 }, (_, i) => maskClusterName("c", i, true));
    expect(new Set(names).size).toBe(25);
  });

  test("tolerates a missing position", () => {
    expect(maskClusterName("prod", -1, true)).toBeString();
  });
});

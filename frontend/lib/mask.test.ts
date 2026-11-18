import { describe, expect, test } from "bun:test";

import { MASK, maskAddress, maskClusterName } from "./mask";

describe("maskAddress", () => {
  test("returns the value when not hidden", () => {
    expect(maskAddress("broker-1:9092", false)).toBe("broker-1:9092");
  });

  test("hides it without leaking its length", () => {
    expect(maskAddress("broker-1:9092", true)).toBe(MASK);
    expect(maskAddress("a", true)).toBe(MASK);
  });
});

describe("maskClusterName", () => {
  test("returns the name when not hidden", () => {
    expect(maskClusterName("prod", 0, false)).toBe("prod");
  });

  test("numbers hidden names by position", () => {
    expect(maskClusterName("prod", 0, true)).toBe("Cluster 1");
    expect(maskClusterName("staging", 2, true)).toBe("Cluster 3");
  });
});

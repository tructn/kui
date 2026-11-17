import { describe, expect, it } from "bun:test";

import { formatHeaderLines, parseHeaderLines } from "./http-headers";

describe("parseHeaderLines", () => {
  it("splits on the first colon so values may contain colons", () => {
    expect(parseHeaderLines("Authorization: Bearer abc\nX-Url: https://example.com:8080/x")).toEqual([
      { name: "Authorization", value: "Bearer abc" },
      { name: "X-Url", value: "https://example.com:8080/x" },
    ]);
  });

  it("skips blank lines, lines without a name and lines without a colon", () => {
    expect(parseHeaderLines("\n  \nno colon\n: no name\nX-A: 1")).toEqual([{ name: "X-A", value: "1" }]);
  });

  it("round-trips through formatHeaderLines", () => {
    const headers = [{ name: "X-Api-Key", value: "k" }];
    expect(parseHeaderLines(formatHeaderLines(headers))).toEqual(headers);
  });
});

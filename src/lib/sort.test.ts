import { describe, expect, test } from "bun:test";

import { nextSort, sortRows } from "./sort";

describe("sortRows", () => {
  test("sorts text naturally and case-insensitively", () => {
    const rows = ["topic-10", "Topic-2", "topic-1", "alpha"];
    expect(sortRows(rows, (r) => r, "asc")).toEqual(["alpha", "topic-1", "Topic-2", "topic-10"]);
  });

  test("sorts numbers numerically, not as text", () => {
    expect(sortRows([10, 9, 100, 1], (r) => r, "asc")).toEqual([1, 9, 10, 100]);
    expect(sortRows([10, 9, 100, 1], (r) => r, "desc")).toEqual([100, 10, 9, 1]);
  });

  test("keeps missing values last in both directions", () => {
    const rows = [{ lag: 5 }, { lag: null }, { lag: 0 }, { lag: undefined }, { lag: 12 }];
    expect(sortRows(rows, (r) => r.lag, "asc").map((r) => r.lag)).toEqual([0, 5, 12, null, undefined]);
    expect(sortRows(rows, (r) => r.lag, "desc").map((r) => r.lag)).toEqual([12, 5, 0, null, undefined]);
  });

  test("is stable: equal values keep their original order", () => {
    const rows = [
      { name: "a", state: "Stable" },
      { name: "b", state: "Empty" },
      { name: "c", state: "Stable" },
      { name: "d", state: "Empty" },
    ];
    expect(sortRows(rows, (r) => r.state, "asc").map((r) => r.name)).toEqual(["b", "d", "a", "c"]);
    expect(sortRows(rows, (r) => r.state, "desc").map((r) => r.name)).toEqual(["a", "c", "b", "d"]);
  });

  test("does not modify the input", () => {
    const rows = [3, 1, 2];
    sortRows(rows, (r) => r, "asc");
    expect(rows).toEqual([3, 1, 2]);
  });
});

describe("nextSort", () => {
  test("cycles a column through ascending, descending and unsorted", () => {
    const asc = nextSort(null, "name");
    expect(asc).toEqual({ key: "name", direction: "asc" });
    const desc = nextSort(asc, "name");
    expect(desc).toEqual({ key: "name", direction: "desc" });
    expect(nextSort(desc, "name")).toBeNull();
  });

  test("a different column starts ascending", () => {
    expect(nextSort({ key: "name", direction: "desc" }, "lag")).toEqual({ key: "lag", direction: "asc" });
  });
});

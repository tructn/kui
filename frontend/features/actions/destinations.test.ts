import { describe, expect, test } from "bun:test";

import { DESTINATIONS, destinationOf } from "./destinations";
import { newDraft } from "./draft";

describe("destinations", () => {
  test("ids are unique", () => {
    const ids = DESTINATIONS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("each available destination makes a draft whose executor maps back to it", () => {
    for (const d of DESTINATIONS) {
      if (d.status !== "available") continue;
      expect(destinationOf(newDraft("c", d.kind).executor).id).toBe(d.id);
    }
  });

  test("planned destinations stay visible in the catalog", () => {
    expect(DESTINATIONS.some((d) => d.status === "planned")).toBe(true);
  });
});

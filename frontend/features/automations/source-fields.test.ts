import { describe, expect, it } from "bun:test";

import { sourceGroups, targetNameFor } from "./source-fields";

describe("sourceGroups", () => {
  it("always offers the parts of a message and adds the sample's fields", () => {
    const groups = sourceGroups(["id", "customer.name"], ["x-source"]);
    expect(groups.map((g) => g.label)).toEqual(["Message", "Value", "Headers"]);
    expect(groups[1]?.fields[1]).toEqual({ label: "customer.name", source: "value.customer.name" });
    expect(groups[2]?.fields[0]?.source).toBe("headers.x-source");
  });

  it("leaves out groups with nothing in them", () => {
    expect(sourceGroups([], []).map((g) => g.label)).toEqual(["Message"]);
  });
});

describe("targetNameFor", () => {
  it("drops the value. and headers. prefixes", () => {
    expect(targetNameFor("value.customer.name", [])).toBe("customer.name");
    expect(targetNameFor("headers.x-source", [])).toBe("x-source");
    expect(targetNameFor("topic", [])).toBe("topic");
  });

  it("never reuses a name", () => {
    expect(targetNameFor("value.id", ["id"])).toBe("id_2");
    expect(targetNameFor("value.id", ["id", "id_2"])).toBe("id_3");
  });
});

import { describe, expect, it } from "bun:test";

import { firstIssue, hostOf, nodeIssue, nodeKey, nodesOf, nodeSummary, parseNodeKey, SOURCE } from "./pipeline";
import { emptyAutomation, emptyRoute, type Automation, type Body, type Route } from "./types";

function route(patch: Partial<Route> = {}, body: Body = { kind: "envelope" }): Route {
  const base = emptyRoute();
  return { ...base, ...patch, action: { ...base.action, url: "https://hooks.example.com/T0/secret", body } };
}

function automation(patch: Partial<Automation> = {}, routes: Route[] = [route()]): Automation {
  return { ...emptyAutomation("local"), topic: "orders", ...patch, routes };
}

const transform = { kind: "transform", route: "route-1" } as const;
const webhook = { kind: "webhook", route: "route-1" } as const;

describe("hostOf", () => {
  it("keeps only the host, never the path a chat webhook hides its secret in", () => {
    expect(hostOf("https://hooks.example.com/T0/secret?x=1")).toBe("hooks.example.com");
    expect(hostOf("http://localhost:8080/hook")).toBe("localhost:8080");
  });

  it("is null for anything that is not a URL", () => {
    expect(hostOf("")).toBeNull();
    expect(hostOf("hooks.example.com")).toBeNull();
  });
});

describe("node keys", () => {
  it("round-trip, even for a route id with a colon", () => {
    for (const ref of [SOURCE, transform, { kind: "webhook", route: "a:b" } as const]) {
      expect(parseNodeKey(nodeKey(ref))).toEqual(ref);
    }
    expect(parseNodeKey("nope:x")).toBeNull();
  });

  it("list the source, then each route's transform and webhook", () => {
    const two = automation({}, [route(), route({ id: "route-2" })]);
    expect(nodesOf(two).map(nodeKey)).toEqual([
      "source",
      "transform:route-1",
      "webhook:route-1",
      "transform:route-2",
      "webhook:route-2",
    ]);
  });
});

describe("nodeIssue", () => {
  it("is null for a complete automation", () => {
    expect(firstIssue(automation())).toBeNull();
  });

  it("asks for a topic, a usable body and a URL", () => {
    expect(nodeIssue(automation({ topic: " " }), SOURCE)).not.toBeNull();
    expect(nodeIssue(automation({}, [route({}, { kind: "template", text: "" })]), transform)).not.toBeNull();
    expect(nodeIssue(automation({}, [route({}, { kind: "mapping", fields: [] })]), transform)).not.toBeNull();
    const noUrl = route();
    noUrl.action = { ...noUrl.action, url: "" };
    expect(firstIssue(automation({}, [noUrl]))?.ref).toEqual(webhook);
  });

  it("rejects a call rate outside what the backend accepts", () => {
    for (const maxPerMinute of [0, 601, Number.NaN]) expect(nodeIssue(automation({ maxPerMinute }), SOURCE)).not.toBeNull();
  });
});

describe("nodeSummary", () => {
  it("describes each node in a line", () => {
    expect(nodeSummary(automation(), SOURCE)).toBe("orders, every message");
    expect(nodeSummary(automation({ query: "value.total > 10" }), SOURCE)).toBe("orders, filtered");
    expect(nodeSummary(automation({}, [route({}, { kind: "mapping", fields: [] })]), transform)).toBe("0 fields");
    const both = route({ split: "value.items", query: "value.ok = true" });
    expect(nodeSummary(automation({}, [both]), transform)).toBe("Whole message, per item");
    expect(nodeSummary(automation(), webhook)).toBe("POST hooks.example.com");
  });

  it("never includes the URL path", () => {
    expect(nodeSummary(automation(), webhook)).not.toContain("secret");
  });
});

describe("emptyRoute", () => {
  it("picks the first id no other route has", () => {
    expect(emptyRoute([route(), route({ id: "route-3" })]).id).toBe("route-2");
  });
});

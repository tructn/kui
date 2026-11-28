import { describe, expect, test } from "bun:test";

import { defaultGroupId, draftProblems, formatDuration, isActive, isEndpoint, newDraft, suggestedPayload } from "./draft";
import type { Action, DiscoveredFunction } from "./types";

function complete(): Action {
  const draft = newDraft("local");
  return {
    ...draft,
    name: "Orders",
    source: { ...draft.source, topic: "demo.orders", groupId: "kui-action-orders" },
    executor: { ...draft.executor, functionName: "OrderProcessor" },
  };
}

describe("defaultGroupId", () => {
  test("slugs the name under the KUI prefix", () => {
    expect(defaultGroupId("Order Processor (dev)")).toBe("kui-action-order-processor-dev");
    expect(defaultGroupId("  ")).toBe("kui-action-action");
    expect(defaultGroupId("x".repeat(80)).length).toBe("kui-action-".length + 40);
  });
});

describe("draftProblems", () => {
  test("a new draft lists what's missing", () => {
    expect(Object.keys(draftProblems(newDraft("local"))).sort()).toEqual(["functionName", "groupId", "name", "topic"]);
  });

  test("a complete draft has none", () => {
    expect(draftProblems(complete())).toEqual({});
  });

  test("checks the function name, timeout and concurrency", () => {
    const action = complete();
    action.executor = { ...action.executor, functionName: "../admin", timeoutSecs: 0, concurrency: 9 };
    expect(Object.keys(draftProblems(action)).sort()).toEqual(["concurrency", "functionName", "timeoutSecs"]);
  });
});

test("isEndpoint accepts bare http URLs only", () => {
  expect(isEndpoint("http://127.0.0.1:3001")).toBe(true);
  expect(isEndpoint("https://localhost:3001/")).toBe(true);
  for (const bad of ["127.0.0.1:3001", "http://h/path", "file:///x", "http://u@h", ""]) {
    expect(isEndpoint(bad)).toBe(false);
  }
});

test("suggestedPayload picks MSK for functions with Kafka events", () => {
  const fn: DiscoveredFunction = {
    logicalId: "Fn",
    resourceType: "AWS::Serverless::Function",
    functionName: { kind: "notSet" },
    runtime: null,
    handler: null,
    codeUri: null,
    packageType: null,
    kafkaTopics: ["demo.orders"],
    metadata: {},
  };
  expect(suggestedPayload(fn)).toBe("msk");
  expect(suggestedPayload({ ...fn, kafkaTopics: [] })).toBe("raw");
});

test("isActive covers every state between Start and stopped", () => {
  expect(isActive({ kind: "starting" })).toBe(true);
  expect(isActive({ kind: "stopping" })).toBe(true);
  expect(isActive({ kind: "stopped" })).toBe(false);
  expect(isActive({ kind: "failed", message: "x" })).toBe(false);
});

test("formatDuration", () => {
  expect(formatDuration(42)).toBe("42 ms");
  expect(formatDuration(1234)).toBe("1.23 s");
  expect(formatDuration(12_345)).toBe("12.3 s");
  expect(formatDuration(125_000)).toBe("2m 5s");
});

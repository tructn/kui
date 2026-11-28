import { describe, expect, test } from "bun:test";

import {
  defaultGroupId,
  draftProblems,
  emptyHistoryText,
  formatDuration,
  isActive,
  isEndpoint,
  newDraft,
} from "./draft";
import type { Action } from "./types";

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

  test("tells a pasted .NET handler apart from a function name", () => {
    const action = complete();
    action.executor = { ...action.executor, functionName: "OrderLambda::OrderLambda.OrderProcessor::FunctionHandler" };
    expect(draftProblems(action).functionName).toContain("handler");
    action.executor = { ...action.executor, functionName: "arn:aws:lambda:local:fn" };
    expect(draftProblems(action).functionName).toBeUndefined();
  });
});

test("isEndpoint accepts bare http URLs only", () => {
  expect(isEndpoint("http://127.0.0.1:3001")).toBe(true);
  expect(isEndpoint("https://localhost:3001/")).toBe(true);
  for (const bad of ["127.0.0.1:3001", "http://h/path", "file:///x", "http://u@h", ""]) {
    expect(isEndpoint(bad)).toBe(false);
  }
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

describe("emptyHistoryText", () => {
  const action = complete();

  test("asks for a start while the action is stopped", () => {
    expect(emptyHistoryText(action, { kind: "stopped" }, 0)).toStartWith("No executions yet");
  });

  test("waits on the topic while nothing has been sent", () => {
    expect(emptyHistoryText(action, { kind: "running" }, 0)).toBe("Waiting for messages on demo.orders…");
  });

  test("points at the function once messages are sent but unanswered", () => {
    const text = emptyHistoryText(action, { kind: "running" }, 1);
    expect(text).toStartWith("Sent 1 message to OrderProcessor");
    expect(text).toContain(action.executor.endpoint);
    expect(emptyHistoryText(action, { kind: "running" }, 3)).toStartWith("Sent 3 messages");
  });
});

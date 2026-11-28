// Pure helpers for the Action editor and run views. The Rust side validates
// again on save (`crates/kui_actions/src/validate.rs`); these only give early,
// field-level feedback.
import { formatNumber } from "@/lib/format";

import { RUNTIMES } from "./runtimes";
import type { Action, Executor, RunState } from "./types";

export const GROUP_PREFIX = "kui-action-";
export const MAX_TIMEOUT_SECS = 900;
export const MAX_CONCURRENCY = 8;

export function newDraft(clusterId: string, kind: Executor["kind"] = "localLambda"): Action {
  return {
    id: "",
    name: "",
    clusterId,
    source: { topic: "", groupId: "", startFrom: "latest" },
    executor: defaultExecutor(kind),
  };
}

function defaultExecutor(kind: Executor["kind"]): Executor {
  switch (kind) {
    // Stepping through the handler in Visual Studio is what most Actions are for.
    case "localLambda":
      return {
        kind,
        runtime: "testTool",
        endpoint: RUNTIMES.testTool.endpoint,
        functionName: "",
        timeoutSecs: RUNTIMES.testTool.timeoutSecs,
        concurrency: 1,
      };
  }
}

/** The consumer group an Action gets unless the user picks one: its own, named after it. */
export function defaultGroupId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return GROUP_PREFIX + (slug || "action");
}

export type DraftField = "name" | "topic" | "groupId" | "endpoint" | "functionName" | "timeoutSecs" | "concurrency";

/** What's missing or wrong, by field. Empty when the draft can be saved. */
export function draftProblems(draft: Action): Partial<Record<DraftField, string>> {
  const problems: Partial<Record<DraftField, string>> = {};
  if (!draft.name.trim()) problems.name = "Give the action a name";
  if (!draft.source.topic) problems.topic = "Choose a topic";
  if (!draft.source.groupId.trim()) problems.groupId = "Name the consumer group";
  const target = draft.executor;
  if (!isEndpoint(target.endpoint)) problems.endpoint = "Use a URL like http://127.0.0.1:3001";
  if (!target.functionName) problems.functionName = "Choose or type a function";
  else if (!/^[A-Za-z0-9_.:-]{1,140}$/.test(target.functionName)) {
    problems.functionName = "Letters, digits, '-', '_', '.' or ':' only";
  } else if (target.functionName.includes("::")) {
    // The Test Tool queues an event under any name, so pasting the handler would wait forever instead of failing.
    problems.functionName = "That's the .NET handler. Use the function's name, like OrderProcessor";
  }
  if (!isWithin(target.timeoutSecs, 1, MAX_TIMEOUT_SECS)) problems.timeoutSecs = `1 to ${MAX_TIMEOUT_SECS} seconds`;
  if (!isWithin(target.concurrency, 1, MAX_CONCURRENCY)) problems.concurrency = `1 to ${MAX_CONCURRENCY}`;
  return problems;
}

export function isEndpoint(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return (url.protocol === "http:" || url.protocol === "https:") && url.pathname === "/" && !url.search && !url.username;
  } catch {
    return false;
  }
}

function isWithin(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}

export function isActive(state: RunState): boolean {
  return state.kind === "starting" || state.kind === "running" || state.kind === "stopping";
}

/**
 * What the empty history table says. A row appears only once the function
 * answers, so messages that were sent but haven't come back yet must not read
 * as "nothing arrived".
 */
export function emptyHistoryText(action: Action, state: RunState, inFlight: number): string {
  if (!isActive(state)) return "No executions yet. Start the action, then produce a message to the topic.";
  if (inFlight === 0) return `Waiting for messages on ${action.source.topic}…`;
  const { functionName, endpoint } = action.executor;
  const sent = inFlight === 1 ? "1 message" : `${formatNumber(inFlight)} messages`;
  return `Sent ${sent} to ${functionName}, waiting for an answer. Is the function running against ${endpoint}?`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
  const minutes = Math.floor(ms / 60_000);
  return `${minutes}m ${Math.round((ms % 60_000) / 1000)}s`;
}

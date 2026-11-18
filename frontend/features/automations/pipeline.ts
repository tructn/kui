import { MAX_PER_MINUTE, type Automation, type Route } from "./types";

/** A node of the pipeline graph: the source topic, and a transform and a webhook per route. */
export type NodeRef = { kind: "source" } | { kind: "transform"; route: string } | { kind: "webhook"; route: string };

export const SOURCE: NodeRef = { kind: "source" };

/** A string id for React Flow and for comparing refs. */
export function nodeKey(ref: NodeRef): string {
  return ref.kind === "source" ? "source" : `${ref.kind}:${ref.route}`;
}

export function parseNodeKey(key: string): NodeRef | null {
  if (key === "source") return SOURCE;
  const [kind, route] = key.split(/:(.*)/s);
  if (!route) return null;
  if (kind === "transform" || kind === "webhook") return { kind, route };
  return null;
}

/** The host of a URL. The path and query are left out: for chat webhooks they are the secret. */
export function hostOf(url: string): string | null {
  try {
    return new URL(url.trim()).host || null;
  } catch {
    return null;
  }
}

/** What is still missing for the node to work, or null when it is ready. */
export function nodeIssue(automation: Automation, ref: NodeRef): string | null {
  if (ref.kind === "source") return sourceIssue(automation);
  const route = automation.routes.find((r) => r.id === ref.route);
  if (!route) return null;
  return ref.kind === "transform" ? transformIssue(route) : webhookIssue(route);
}

function sourceIssue({ topic, maxPerMinute }: Automation): string | null {
  if (topic.trim() === "") return "Choose the topic to read.";
  if (!Number.isInteger(maxPerMinute) || maxPerMinute < 1 || maxPerMinute > MAX_PER_MINUTE) {
    return `Calls a minute must be between 1 and ${MAX_PER_MINUTE}.`;
  }
  return null;
}

function transformIssue({ action }: Route): string | null {
  switch (action.kind) {
    case "webhook":
      switch (action.body.kind) {
        case "envelope":
          return null;
        case "template":
          return action.body.text.trim() === "" ? "Write the text to send." : null;
        case "mapping":
          return action.body.fields.length === 0 ? "Add at least one field." : null;
      }
  }
}

function webhookIssue({ action }: Route): string | null {
  switch (action.kind) {
    case "webhook":
      return hostOf(action.url) === null ? "Enter the full webhook URL, starting with https://." : null;
  }
}

/** Every node, source first, then each route's transform and webhook. */
export function nodesOf(automation: Automation): NodeRef[] {
  return [
    SOURCE,
    ...automation.routes.flatMap((r): NodeRef[] => [
      { kind: "transform", route: r.id },
      { kind: "webhook", route: r.id },
    ]),
  ];
}

/** The first node with something missing, to open when a save is tried too early. */
export function firstIssue(automation: Automation): { ref: NodeRef; issue: string } | null {
  for (const ref of nodesOf(automation)) {
    const issue = nodeIssue(automation, ref);
    if (issue) return { ref, issue };
  }
  return null;
}

/** One line for the node on the canvas. */
export function nodeSummary(automation: Automation, ref: NodeRef): string {
  if (ref.kind === "source") {
    const topic = automation.topic.trim();
    if (topic === "") return "No topic yet";
    return automation.query?.trim() ? `${topic}, filtered` : `${topic}, every message`;
  }
  const route = automation.routes.find((r) => r.id === ref.route);
  if (!route) return "";
  return ref.kind === "transform" ? transformSummary(route) : webhookSummary(route);
}

function transformSummary({ action, split }: Route): string {
  const { body } = action;
  const what = (() => {
    switch (body.kind) {
      case "envelope":
        return "Whole message";
      case "template":
        return "Custom text";
      case "mapping":
        return `${body.fields.length} ${body.fields.length === 1 ? "field" : "fields"}`;
    }
  })();
  return split ? `${what}, per item` : what;
}

function webhookSummary({ action }: Route): string {
  switch (action.kind) {
    case "webhook": {
      const host = hostOf(action.url);
      return host ? `${action.method} ${host}` : "No webhook yet";
    }
  }
}

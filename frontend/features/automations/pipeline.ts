import { MAX_PER_MINUTE, type Automation } from "./types";

/** The steps of an automation, as in ETL: extract messages from a topic, transform them, load them into a webhook. */
export const STAGES = [
  { id: "extract", label: "Extract", caption: "Pick the topic" },
  { id: "transform", label: "Transform", caption: "Choose what to send" },
  { id: "load", label: "Load", caption: "Pick the webhook" },
] as const;

export type StageId = (typeof STAGES)[number]["id"];

/** The host of a URL. The path and query are left out: for chat webhooks they are the secret. */
export function hostOf(url: string): string | null {
  try {
    return new URL(url.trim()).host || null;
  } catch {
    return null;
  }
}

/** What is still missing for the stage to work, or null when it is ready. */
export function stageIssue(stage: StageId, automation: Automation): string | null {
  switch (stage) {
    case "extract":
      return automation.topic.trim() === "" ? "Choose the topic to read." : null;
    case "transform":
      return bodyIssue(automation);
    case "load": {
      const { action, maxPerMinute } = automation;
      switch (action.kind) {
        case "webhook":
          if (hostOf(action.url) === null) return "Enter the full webhook URL, starting with https://.";
      }
      if (!Number.isInteger(maxPerMinute) || maxPerMinute < 1 || maxPerMinute > MAX_PER_MINUTE) {
        return `Calls a minute must be between 1 and ${MAX_PER_MINUTE}.`;
      }
      return null;
    }
  }
}

function bodyIssue({ action }: Automation): string | null {
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

/** One line for the pipeline rail. */
export function stageSummary(stage: StageId, automation: Automation): string {
  switch (stage) {
    case "extract": {
      const topic = automation.topic.trim();
      if (topic === "") return "No topic yet";
      return automation.query?.trim() ? `${topic}, filtered` : `${topic}, every message`;
    }
    case "transform": {
      const { body } = automation.action;
      switch (body.kind) {
        case "envelope":
          return "Whole message as JSON";
        case "template":
          return "Custom text";
        case "mapping":
          return `${body.fields.length} ${body.fields.length === 1 ? "field" : "fields"}`;
      }
    }
    case "load": {
      const { action } = automation;
      switch (action.kind) {
        case "webhook": {
          const host = hostOf(action.url);
          return host ? `${action.method} ${host}` : "No webhook yet";
        }
      }
    }
  }
}

/** A step opens once every step before it is complete, so they are filled in order. */
export function isUnlocked(stage: StageId, automation: Automation): boolean {
  for (const { id } of STAGES) {
    if (id === stage) return true;
    if (stageIssue(id, automation) !== null) return false;
  }
  return false;
}

/** The step after `stage`, or null for the last one. */
export function nextStage(stage: StageId): StageId | null {
  const index = STAGES.findIndex((s) => s.id === stage);
  return STAGES[index + 1]?.id ?? null;
}

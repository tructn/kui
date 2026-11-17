import { describe, expect, it } from "bun:test";

import { hostOf, isUnlocked, nextStage, stageIssue, stageSummary } from "./pipeline";
import { emptyAutomation, type Automation, type Body } from "./types";

function automation(patch: Partial<Automation> = {}, body: Body = { kind: "envelope" }): Automation {
  const base = emptyAutomation("local");
  return { ...base, topic: "orders", ...patch, action: { ...base.action, url: "https://hooks.example.com/T0/secret", body } };
}

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

describe("stageIssue", () => {
  it("is null for a complete automation", () => {
    for (const stage of ["extract", "transform", "load"] as const) expect(stageIssue(stage, automation())).toBeNull();
  });

  it("asks for a topic, a usable body and a URL", () => {
    expect(stageIssue("extract", automation({ topic: " " }))).not.toBeNull();
    expect(stageIssue("transform", automation({}, { kind: "template", text: "" }))).not.toBeNull();
    expect(stageIssue("transform", automation({}, { kind: "mapping", fields: [] }))).not.toBeNull();
    const noUrl = automation();
    noUrl.action = { ...noUrl.action, url: "" };
    expect(stageIssue("load", noUrl)).not.toBeNull();
  });

  it("rejects a call rate outside what the backend accepts", () => {
    expect(stageIssue("load", automation({ maxPerMinute: 0 }))).not.toBeNull();
    expect(stageIssue("load", automation({ maxPerMinute: 601 }))).not.toBeNull();
    expect(stageIssue("load", automation({ maxPerMinute: Number.NaN }))).not.toBeNull();
  });
});

describe("stageSummary", () => {
  it("describes each stage in a line", () => {
    expect(stageSummary("extract", automation())).toBe("orders, every message");
    expect(stageSummary("extract", automation({ query: "value.total > 10" }))).toBe("orders, filtered");
    expect(stageSummary("transform", automation({}, { kind: "mapping", fields: [] }))).toBe("0 fields");
    expect(stageSummary("load", automation())).toBe("POST hooks.example.com");
  });

  it("never includes the URL path", () => {
    expect(stageSummary("load", automation())).not.toContain("secret");
  });
});

describe("isUnlocked", () => {
  it("opens the first step always and the others only after the ones before are complete", () => {
    const blank = automation({ topic: "" });
    expect(isUnlocked("extract", blank)).toBe(true);
    expect(isUnlocked("transform", blank)).toBe(false);
    expect(isUnlocked("load", blank)).toBe(false);
    expect(isUnlocked("transform", automation())).toBe(true);
    expect(isUnlocked("load", automation({}, { kind: "mapping", fields: [] }))).toBe(false);
  });
});

describe("nextStage", () => {
  it("follows the order and ends at load", () => {
    expect(nextStage("extract")).toBe("transform");
    expect(nextStage("load")).toBeNull();
  });
});

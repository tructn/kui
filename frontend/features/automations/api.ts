// Mirrors `crates/kui_desktop/src/features/automations/commands.rs`.
import { callCommand } from "@/lib/invoke";

import type { Automation, AutomationStatus, Body, PreviewSample } from "./types";

export const automationsApi = {
  list: () => callCommand<Automation[]>("list_automations"),
  save: (automation: Automation) => callCommand<Automation>("save_automation", { automation }),
  setEnabled: (automationId: string, enabled: boolean) =>
    callCommand<Automation>("set_automation_enabled", { automationId, enabled }),
  remove: (automationId: string) => callCommand<void>("delete_automation", { automationId }),
  statuses: () => callCommand<AutomationStatus[]>("automation_statuses"),
  /** Sends the action once with a sample message. Resolves to the HTTP status the webhook answered. */
  /** What the body would be for a sample message. Rejects with why the body can't be built. */
  previewBody: (name: string, body: Body, sample: PreviewSample) =>
    callCommand<string>("preview_automation_body", { name, body, sample }),
  test: (automation: Automation) => callCommand<{ status: number }>("test_automation", { automation }),
};

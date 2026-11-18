// Mirrors `crates/kui_desktop/src/features/automations/commands.rs`.
import { callCommand } from "@/lib/invoke";

import type { Automation, AutomationStatus, Body, BodyPreview, PreviewSample } from "./types";

export const automationsApi = {
  list: () => callCommand<Automation[]>("list_automations"),
  save: (automation: Automation) => callCommand<Automation>("save_automation", { automation }),
  setEnabled: (automationId: string, enabled: boolean) =>
    callCommand<Automation>("set_automation_enabled", { automationId, enabled }),
  remove: (automationId: string) => callCommand<void>("delete_automation", { automationId }),
  statuses: () => callCommand<AutomationStatus[]>("automation_statuses"),
  /** What the body would be for a sample message. Rejects with why the body can't be built. */
  previewBody: (name: string, body: Body, split: string | null, sample: PreviewSample) =>
    callCommand<BodyPreview>("preview_automation_body", { name, body, split, sample }),
  /** Sends route number `route` once with `sample`, or a made-up message. Resolves to the HTTP status the webhook answered. */
  test: (automation: Automation, route: number, sample: PreviewSample | null) =>
    callCommand<{ status: number }>("test_automation", { automation, route, sample }),
};

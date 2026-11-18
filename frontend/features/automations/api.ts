// Mirrors `crates/kui_desktop/src/features/automations/commands.rs`.
import { callCommand } from "@/lib/invoke";

import type {
  Automation,
  AutomationStatus,
  Body,
  BodyPreview,
  ConnectOptions,
  ConnectPlan,
  ConnectTarget,
  LoadedMessages,
  PreviewSample,
  PublishedConnector,
  ReplayReport,
  ReplaySource,
} from "./types";

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
  /** Saves the pipeline to a file the user picks, without URLs or header values. Null when cancelled. */
  exportFile: (automation: Automation) => callCommand<string | null>("export_pipeline_file", { automation }),
  /** Opens a pipeline file as an unsaved, disabled automation. Null when cancelled. */
  importFile: (clusterId: string) => callCommand<Automation | null>("import_pipeline_file", { clusterId }),
  /** Reads a message export the user picks. Null when cancelled. */
  loadReplayFile: () => callCommand<LoadedMessages | null>("load_replay_file"),
  /** What the pipeline would send for existing messages. Sends nothing. */
  dryRun: (automation: Automation, source: ReplaySource) =>
    callCommand<ReplayReport>("dry_run_automation", { automation, source }),
  /** Sends the requests for existing messages, up to the pipeline's per-minute limit. */
  replay: (automation: Automation, source: ReplaySource) =>
    callCommand<ReplayReport>("replay_automation", { automation, source }),
  previewConnect: (automation: Automation, options: ConnectOptions) =>
    callCommand<ConnectPlan>("preview_kafka_connect", { automation, options }),
  publishConnect: (automation: Automation, target: ConnectTarget, options: ConnectOptions) =>
    callCommand<PublishedConnector[]>("publish_to_kafka_connect", { automation, target, options }),
};

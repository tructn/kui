// Mirrors `crates/kui_desktop/src/features/actions/commands.rs`.
import { callCommand } from "@/lib/invoke";

import type {
  Action,
  EndpointCheck,
  ExecutionDetail,
  ExecutionSummary,
  LambdaRuntime,
  RunStatus,
} from "./types";

export const actionsApi = {
  list: (clusterId: string) => callCommand<Action[]>("list_actions", { clusterId }),
  save: (action: Action) => callCommand<Action>("save_action", { action }),
  remove: (actionId: string) => callCommand<void>("delete_action", { actionId }),
  /** Opens a file window in Rust and adds the file's Actions to the cluster. `null` when the user cancels. */
  import: (clusterId: string) => callCommand<Action[] | null>("import_actions", { clusterId }),
  /** Opens a save window in Rust and writes a shareable file. The path, or `null` when the user cancels. */
  export: (clusterId: string, actionIds: string[]) =>
    callCommand<string | null>("export_actions", { clusterId, actionIds }),
  statuses: (clusterId: string) => callCommand<RunStatus[]>("action_statuses", { clusterId }),
  /** Joins the Action's consumer group and starts invoking; commits offsets as it goes. */
  start: (actionId: string) => callCommand<RunStatus>("start_action", { actionId }),
  /** Reads one message by position and sends it to the Action's target once; nothing is committed. */
  sendOne: (actionId: string, partition: number, offset: number) =>
    callCommand<ExecutionDetail>("send_to_action", { actionId, partition, offset }),
  stop: (actionId: string) => callCommand<boolean>("stop_action", { actionId }),
  history: (actionId: string) => callCommand<ExecutionSummary[]>("action_history", { actionId }),
  execution: (actionId: string, executionId: number) =>
    callCommand<ExecutionDetail | null>("action_execution", { actionId, executionId }),
  clearHistory: (actionId: string) => callCommand<void>("clear_action_history", { actionId }),
  checkEndpoint: (endpoint: string, runtime: LambdaRuntime) =>
    callCommand<EndpointCheck>("check_lambda_endpoint", { endpoint, runtime }),
};

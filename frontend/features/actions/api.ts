// Mirrors `crates/kui_desktop/src/features/actions/commands.rs`.
import { callCommand } from "@/lib/invoke";

import type {
  Action,
  Discovery,
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
  statuses: (clusterId: string) => callCommand<RunStatus[]>("action_statuses", { clusterId }),
  /** Joins the Action's consumer group and starts invoking; commits offsets as it goes. */
  start: (actionId: string) => callCommand<RunStatus>("start_action", { actionId }),
  stop: (actionId: string) => callCommand<boolean>("stop_action", { actionId }),
  history: (actionId: string) => callCommand<ExecutionSummary[]>("action_history", { actionId }),
  execution: (actionId: string, executionId: number) =>
    callCommand<ExecutionDetail | null>("action_execution", { actionId, executionId }),
  clearHistory: (actionId: string) => callCommand<void>("clear_action_history", { actionId }),
  checkEndpoint: (endpoint: string, runtime: LambdaRuntime) =>
    callCommand<EndpointCheck>("check_lambda_endpoint", { endpoint, runtime }),
  /** Opens a folder picker when `projectDir` is null; resolves null if the user cancels. */
  discover: (projectDir: string | null) =>
    callCommand<Discovery | null>("discover_lambda_functions", { projectDir }),
};

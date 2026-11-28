// Mirrors `crates/kui_actions/src/model.rs`.

export type StartFrom = "latest" | "earliest";
export type PayloadFormat = "raw" | "msk";
export type LambdaRuntime = "sam" | "testTool";

export interface Source {
  topic: string;
  groupId: string;
  startFrom: StartFrom;
}

export interface LambdaTarget {
  runtime: LambdaRuntime;
  endpoint: string;
  functionName: string;
  projectDir: string | null;
  payload: PayloadFormat;
  timeoutSecs: number;
  concurrency: number;
  /** One message at a time; a message that got no answer is sent again on the next Start instead of skipped. */
  debug: boolean;
}

export type Executor = { kind: "localLambda" } & LambdaTarget;

export interface Action {
  /** Empty for an Action that hasn't been saved yet. */
  id: string;
  name: string;
  clusterId: string;
  source: Source;
  executor: Executor;
}

export type RunState =
  | { kind: "stopped" }
  | { kind: "starting" }
  | { kind: "running" }
  | { kind: "stopping" }
  | { kind: "failed"; message: string };

export interface RunStatus {
  actionId: string;
  state: RunState;
  processed: number;
  failed: number;
  inFlight: number;
  startedAt: number | null;
}

export type ExecutionStatus = "succeeded" | "functionError" | "failed" | "timedOut";

export interface ExecutionSummary {
  id: number;
  partition: number;
  offset: number;
  timestamp: number | null;
  key: string | null;
  status: ExecutionStatus;
  startedAt: number;
  durationMs: number;
  error: string | null;
}

export interface Body {
  text: string;
  truncated: boolean;
}

export interface ExecutionDetail extends ExecutionSummary {
  function: string;
  request: Body | null;
  response: Body | null;
}

export type EndpointCheck =
  | { kind: "ready" }
  | { kind: "notRunning"; message: string }
  | { kind: "unexpected"; message: string };

export type ConfiguredName = { kind: "notSet" } | { kind: "literal"; value: string } | { kind: "computed" };

export interface DiscoveredFunction {
  logicalId: string;
  resourceType: string;
  functionName: ConfiguredName;
  runtime: string | null;
  handler: string | null;
  codeUri: string | null;
  packageType: string | null;
  kafkaTopics: string[];
  metadata: Record<string, string>;
}

export interface Discovery {
  projectDir: string;
  template: string;
  functions: DiscoveredFunction[];
  skipped: string[];
}

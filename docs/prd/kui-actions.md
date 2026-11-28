# KUI Actions

Run local code whenever a Kafka message arrives, and see exactly what happened.

| | |
|---|---|
| Status | Draft |
| Phase 1 | Local AWS Lambda through the AWS Lambda Test Tool (debugger) or AWS SAM CLI |
| Phase 2 | HTTP request |
| Phase 3 | Local Azure Functions through Azure Functions Core Tools |
| Audience | Developers building Kafka-driven services on their own machine |

## 1. Problem

Testing a Kafka-triggered Lambda locally is painful. To see a function react to real messages a developer has to
deploy it, wire up an MSK event source mapping, and read CloudWatch logs, or hand-craft event JSON files and run
`sam local invoke` one message at a time. Either way the feedback loop is slow, and the event in the test rarely
matches the message that broke things.

KUI already connects to the cluster and shows the messages. Actions let it hand each message to the developer's
local code and show the request, the response and any error next to the message that caused it.

### Mental model: EventBridge Pipes, on your laptop

In AWS, teams connect a Kafka topic to a Lambda function or an HTTP endpoint with **EventBridge Pipes** (or a
Lambda event source mapping): *source → optional filter → target*. Reproducing that locally means deploying
infrastructure or giving up on realistic events.

An Action is that pipe, run by KUI, with no EventBridge, IAM, MSK or deployment involved:

| EventBridge Pipes | KUI Action |
|---|---|
| Source: MSK / self-managed Kafka | Source: any cluster saved in KUI |
| Filtering (event patterns) | MQL filter *(1.1)* |
| Target: Lambda function | Local Lambda executor via SAM *(Phase 1)* |
| Target: API destination | HTTP executor *(Phase 2)* |
| CloudWatch logs and metrics | Execution history in KUI |

The goal is that a handler which works with an Action works unchanged behind the real pipe or event source
mapping, because it receives the same event shape (section 8.3). KUI imitates the *behaviour* developers
depend on; it doesn't emulate the EventBridge API or read pipe definitions.

## 2. Positioning

**Actions are a local development and debugging tool.** They exist to shorten the loop between "a message
arrived" and "I can see what my handler did with it".

They are **not** a data pipeline, an ETL system, a stream processor or a replacement for event source mappings,
Kafka Connect or any production automation. That shapes the design:

- Actions run only while KUI is open, and only after the user presses Start. Nothing starts on launch.
- Delivery is at-least-once with no retries, dead-letter queues or exactly-once guarantees.
- Throughput targets are a developer's laptop: tens of messages per second, not thousands.
- Execution history is a bounded, in-memory debugging view, not an audit log.

If a request pushes Actions towards being infrastructure (scheduling, clustering, durable retries, running
headless), the answer is no.

### Non-goals

- Calling, emulating or importing EventBridge (buses, rules, Pipes definitions), AWS deployment management or
  production event source mappings. Actions mimic their behaviour locally; they don't integrate with them.
- A Lambda runtime, runtime emulation or parsing handler source code (C#, Python, Go...).
- Running while KUI is closed, or across machines.
- Retries, dead-letter topics, transactional or exactly-once processing.
- Writing results back to Kafka (a "Kafka produce" executor may come later as an explicit, separate executor).

## 3. Users and scenarios

1. **Debug a failing message.** A consumer broke in staging. The developer points an Action at the topic, starts
   from the offset that failed, and steps through the handler in their IDE while SAM invokes it.
2. **Develop against live traffic.** While writing a new handler, the developer keeps an Action running on the
   real topic and watches each invocation's response update in KUI.
3. **Test an existing MSK consumer unchanged.** A function written for AWS MSK triggers receives a correctly shaped
   MSK event, so no test-only code paths are needed.
4. **Replay.** The developer fixes a bug and re-runs the same message from history without producing it again.
5. *(Phase 2)* **Call a local service.** The same flow posts each message to `http://localhost:8080/webhook`.

## 4. Concepts

An **Action** connects a **source** to an **executor**:

```text
Source (cluster, topic, group, start position, optional filter)
  → Payload builder (raw value | AWS MSK event | ... per executor)
  → Executor (Local Lambda | HTTP | later: custom process, Kafka produce)
  → Execution record (status, duration, request, response, error)
```

- **Source** and **execution history** are shared by every executor. Adding an executor never changes the
  consumer loop.
- **Executor** is a closed set of variants. Each brings its own config, payload modes and error mapping. Adding
  one is a new variant, and an exhaustive `match` shows every place to update.
- An Action has exactly one executor. Fan-out to several targets means several Actions.

## 5. Phasing

| Phase | Scope |
|---|---|
| **1. MVP** | Action CRUD, Start/Stop, dedicated consumer group, Local Lambda executor against a running `sam local start-lambda`, SAM template discovery, Raw and MSK payloads, live execution history. |
| **1.1** | Re-run from history, "Invoke once" with a test payload, MQL filter on the source, EventBridge Pipes payload mode, start/stop `sam local start-lambda` from KUI, stop-on-error option. |
| **2** | HTTP request executor. This also covers HTTP-triggered Azure Functions. |
| **3** | Local Azure Functions executor for Kafka-triggered functions, through Azure Functions Core Tools. Starts with a proof of concept (section 9a). |
| Later | Custom process executor, Kafka produce executor, MSK batch size > 1, history export. |

The rest of this document specifies Phase 1 and 1.1 in detail and Phase 2 at the level needed to keep the design
open for it.

## 6. Source

| Setting | Default | Notes |
|---|---|---|
| Cluster | current cluster | Saved by cluster id. |
| Topic | — | Required. |
| Partitions | all | Optional subset. |
| Consumer group | `kui-action-<slug>` | See below. |
| Start position | Latest | Latest, Earliest, or the group's committed offsets. 1.1: a specific offset or timestamp, reusing the Messages page picker. |
| Filter *(1.1)* | none | An MQL query (same language and validation as the Messages page). Messages that don't match are skipped and committed. |

**Consumer groups.** By default each Action gets its own group named `kui-action-<slug>`, so it never takes
partitions away from a real application. Choosing an existing group is allowed but needs explicit confirmation,
with the warning that KUI will join the group, rebalance it and commit offsets for it. This is the first KUI
feature that commits offsets for a group, so the Start button counts as the explicit user action that the
project's security rules require.

## 7. Delivery semantics

These are shown in the UI (an info tip on Start), not just written down here.

- **At-least-once.** An offset is committed only after its invocation finishes, whether it succeeds or fails.
  Committing and invoking can't be atomic, so stopping, crashing or rebalancing can run a message again.
  Handlers under test should tolerate duplicates.
- **A failed invocation is recorded and skipped.** There are no retries in Phase 1. With *stop on error* (1.1)
  the Action stops at the first failure instead, without committing that message, so the next Start begins
  with it again. That is the debugging loop for "fix and retry".
- **Ordering.** With concurrency 1 (the default), messages are invoked one at a time in offset order per
  partition. With concurrency N, up to N invocations run at once, at most one per partition, so per-partition
  order still holds and commits never skip an unfinished offset.
- **Backpressure.** When every slot is busy, KUI stops fetching until one frees up. A slow handler slows the
  Action down; it never freezes the UI or buffers unbounded messages.
- **Timeouts.** Each invocation has a timeout (default 30 s, max 15 min to match Lambda). A timed-out invocation
  is recorded as failed. The local container may keep running; KUI simply stops waiting.
- **Debug mode** (per Action, on by default) is for stepping through the handler at a breakpoint. Concurrency is
  1 and the timeout defaults to 15 min. An invocation that gets *no answer* (timeout, endpoint down, unknown
  function) stops the Action without committing it, so the next Start sends the same message; one the target
  *answered* (success, function error, rejected payload) is committed as usual, so a bad message never blocks the
  Action. Stop doesn't wait for a call paused in the debugger: it leaves the group within seconds, and that
  message runs again on the next Start.
- **Stop** stops fetching, waits up to the invocation timeout for in-flight calls, commits what finished, then
  leaves the group. Quitting KUI does the same with a short grace period.

## 8. Local Lambda executor (Phase 1)

### 8.1 Runtime

Two local hosts serve the same Invoke API, and an Action picks one (`runtime`):

| | AWS Lambda Test Tool (default) | AWS SAM CLI |
|---|---|---|
| Function runs | As a normal process the developer starts, e.g. with F5 in Visual Studio or Rider, so breakpoints work | In a Docker container SAM starts |
| Start | `dotnet lambda-test-tool start --lambda-emulator-port 5050` | `sam local start-lambda` |
| Default endpoint | `http://localhost:5050` | `http://127.0.0.1:3001` |
| Function name | The name after the port in the function's `AWS_LAMBDA_RUNTIME_API` (`localhost:5050/OrderProcessor`) | The template's logical ID |
| Endpoint check | `GET /lambda-runtime-api/healthcheck` answers `health` | Probe a made-up function, expect `ResourceNotFound` |

The Test Tool queues an invocation for any name until a process asks for events under that name, so SAM's probe
would hang there, and a mistyped name shows up as a timeout. Its timeout message says to check
`AWS_LAMBDA_RUNTIME_API`. The editor shows a ready-to-paste `launchSettings.json` profile for the chosen
function, built from the template's handler when there is one.

For SAM, KUI talks to the persistent endpoint started by:

```bash
sam build
sam local start-lambda          # http://127.0.0.1:3001 by default
```

- **Endpoint**: default `http://127.0.0.1:3001`, editable per Action.
- **Check endpoint**: a button and an automatic check on Start. It reports *reachable*, *not running* (connection
  refused) or *not a SAM endpoint*.
- **Never** run `sam local invoke` per message: it starts a container for every call and is far too slow.
- **Start SAM from KUI (1.1).** The user picks the project directory and presses *Start SAM*. KUI shows the exact
  command first, runs `sam local start-lambda --port <port>` with a fixed argument list in that directory (no
  shell, nothing taken from Kafka data), and streams its output to a log panel. KUI only stops processes it
  started itself. Before launching it checks that `sam` is on `PATH` and that Docker responds, and explains
  either failure with an install link.

**Transport.** The Lambda Invoke API is one HTTP call:
`POST /2015-03-31/functions/{name}/invocations` with the payload as the body. The response body is the
function's result, and the `X-Amz-Function-Error` header marks a function error. SAM local doesn't check
SigV4 signatures. **Recommendation:** call it with the `reqwest` client KUI already ships rather than adding
`aws-sdk-lambda` and `aws-config`. They would bring a large new dependency tree for CI to audit, and they look
for AWS credentials on the machine, which this feature shouldn't touch. Revisit only if a real deployed-Lambda
target is ever in scope (it isn't).

### 8.2 Function discovery

The user picks a SAM project directory. KUI reads the first template it finds, in this order:

1. `.aws-sam/build/template.yaml`: what `sam local start-lambda` actually serves after `sam build`.
2. `template.yaml`, `template.yml`, `template.json` in the project root.

It lists resources of type `AWS::Serverless::Function` and `AWS::Lambda::Function` with:

| Field | Source | Notes |
|---|---|---|
| Logical ID | resource key | **The identifier KUI invokes.** SAM local addresses functions by logical ID. |
| Function name | `Properties.FunctionName` | Shown when it's a plain string; intrinsics like `!Sub` are shown as "(computed)". |
| Runtime, Handler, CodeUri | `Properties`, falling back to `Globals.Function` | Display only. |
| Package type | `PackageType` | Image functions have no Runtime/Handler. |
| Metadata | `Metadata` | e.g. `BuildMethod`, shown in a details row. |

Rules:

- CloudFormation short-form tags (`!Ref`, `!Sub`, `!GetAtt`, `!If`...) must parse without errors. KUI reads them
  as opaque values and never evaluates them.
- Templates are user files: cap the size (1 MiB), and report a parse error with the file and line rather than
  failing the whole flow.
- Nested stacks (`AWS::Serverless::Application`) are listed as unsupported, not followed.
- If discovery finds nothing, or there is no project, the user can type a function name by hand. Discovery is a
  convenience, never a requirement.
- The template is the only source of truth. KUI never reads handler source code.

### 8.3 Payload modes

**Raw value.** The message value bytes are sent as the request body unchanged. A null value (tombstone) sends
`null`. SAM requires a JSON body, so a value that isn't valid JSON fails with *Invalid payload: the message value
isn't JSON; use the MSK event format to send any bytes*, instead of a cryptic error from SAM.

**AWS MSK event.** The shape AWS delivers to MSK-triggered functions:

```json
{
  "eventSource": "aws:kafka",
  "eventSourceArn": "arn:aws:kafka:local:000000000000:cluster/kui/<cluster-id>",
  "bootstrapServers": "<cluster bootstrap servers>",
  "records": {
    "orders-0": [
      {
        "topic": "orders",
        "partition": 0,
        "offset": 15,
        "timestamp": 1764316800000,
        "timestampType": "CREATE_TIME",
        "key": "<base64>",
        "value": "<base64>",
        "headers": [{ "traceId": [104, 105] }]
      }
    ]
  }
}
```

- `key`/`value` are base64 and omitted when null, as AWS does. Header values are byte arrays, as AWS sends them.
- `eventSourceArn` is a clearly fake local ARN. KUI never invents a real-looking account id.
- Phase 1 sends **one record per invocation**, so each history row maps to one message. Batching (AWS default up
  to 100) is a later option because it changes how failures and commits map back to messages.
- The builder is a pure function with golden-file tests against AWS's documented sample event.

**EventBridge Pipes event *(1.1)*.** Pipes hands its target a flat JSON **array** of records instead of the
event source mapping's `records` map. Each record carries `eventSource`, `eventSourceArn`, `eventSourceKey`
(`topic-partition`), `topic`, `partition`, `offset`, `timestamp`, `timestampType`, `key`, `value` and
`headers`. Handlers written for a pipe expect that shape, so it gets its own mode. Confirm the exact fields
against AWS's Pipes Kafka source documentation and capture them as a golden file before building it. Phase 1
sends a one-element array, as with MSK.

### 8.4 Settings

Function, endpoint, payload mode, timeout (default 30 s), concurrency (default 1, max 8). Invocation type is
always `RequestResponse`. `Event` (async) returns no result, which defeats the debugging purpose.

## 9. HTTP executor (Phase 2, design constraints only)

So Phase 1 doesn't box it in:

- Config: method, URL, headers, body mode (raw value | JSON envelope with metadata), timeout, concurrency.
- Success is any 2xx response. The status, response headers and body are recorded the same way as Lambda results.
- Header values marked secret (e.g. `Authorization`) are stored in the OS keychain using the same mechanism as
  cluster passwords, never in `actions.json`, and are masked in history.
- URLs that aren't localhost are allowed but get a warning, because the feature is meant for local services.

## 9a. Local Azure Functions executor (Phase 3)

The Azure counterpart of section 8. Functions with HTTP triggers are already reachable through the HTTP executor;
this executor is for functions with a **Kafka trigger**, which can't be reached with a plain HTTP call.

| | Local Lambda (Phase 1) | Local Azure Functions (Phase 3) |
|---|---|---|
| Runtime | `sam local start-lambda`, default `:3001` | Azure Functions Core Tools `func start`, default `:7071` |
| Invoke | `POST /2015-03-31/functions/{name}/invocations` | `POST /admin/functions/{name}` with `{"input": "<payload>"}`, the local admin endpoint for test-invoking functions that aren't HTTP-triggered |
| Discovery | Parse the SAM template | Ask the running host: `GET /admin/functions`. .NET isolated and Python v2 declare triggers in code, so there's no reliable static file. A manual function name stays available |
| Event shape | Raw / MSK / Pipes | Raw / Kafka trigger event (`KafkaEventData`: topic, partition, offset, timestamp, key, value, headers) |
| Start from KUI | `sam local start-lambda` (1.1) | `func start` in the chosen project directory, with the same rules (explicit button, fixed arguments, no shell) |

**Proof of concept first.** Before building, confirm with Core Tools and a sample project:

1. A Kafka-triggered function accepts input through `/admin/functions/{name}`, and the payload binds to the
   trigger parameter (`string`, `KafkaEventData<string>` and a POCO) in both the .NET isolated model and one
   non-.NET language.
2. The success and failure responses carry enough to fill execution history. The admin endpoint returns `202`
   without the function's result, so status and errors may have to come from the host's log output (the
   `func start` log panel) rather than the response body.
3. Whether any local setup requires the admin (master) key. If it does, the key is stored in the OS keychain and
   masked like other secrets.

If point 1 fails, fall back to documenting the HTTP executor with an HTTP-triggered wrapper function, and drop
this executor.

Errors to add to section 12: Core Tools not installed (`func --version` fails), host not running on the
configured port, function not found in `/admin/functions`, and the binding error from point 1.

Out of scope, as with AWS: Azure deployment, Event Grid / Event Hubs integration, and reading `local.settings.json`
secrets into KUI.

## 10. Execution history

One row per invocation, newest first, live while the Action runs:

- Message: topic, partition, offset, timestamp, key (preview).
- Executor target (function logical ID / URL), status (succeeded / function error / failed / timed out), duration,
  start time.
- Detail panel: request payload, response payload, error type and message (for Lambda function errors, the
  `errorType`, `errorMessage` and `stackTrace` from the response, formatted).
- Counters on the Action: processed, failed, in flight, consumer lag.
- *(1.1)* **Re-run** a row: invoke again with the recorded request. It doesn't touch Kafka offsets.
- *(1.1)* **Invoke once**: send a hand-written or generated payload (reusing the data generator) without Kafka.

Limits, because a busy topic must not exhaust memory or freeze the UI:

- Last 500 executions per Action in memory, older ones dropped. History is cleared when KUI quits (Phase 1).
- Request and response bodies are cut to the same byte budget the Messages page uses, with a "truncated" badge.
- Updates reach the UI in small batches (as live tail does), not one IPC message per invocation.
- All payloads are untrusted and are rendered as text only.

## 11. UI

- **Actions page** in the sidebar, per cluster: a list with name, topic → target, state (stopped / running /
  error), processed and failed counts, and a Start/Stop button. The sidebar entry shows a dot while any Action
  runs, because Actions keep running when the user goes to another page.
- **Create/edit** in one sheet with sections rather than an 8-step wizard. Each section validates as you go:
  1. Source: topic, partitions, consumer group, start position.
  2. Executor: type (Local Lambda; HTTP shown as "coming soon" in Phase 1).
  3. Target: endpoint with a *Check* button, project directory, discovered functions (or a manual name).
  4. Payload: mode with a preview built from the latest message on the topic.
  5. Run: timeout, concurrency, stop on error.
  Save, or Save and start.
- **Action detail**: the counters, the history table and its detail sheet, plus the SAM log panel when KUI started
  SAM.
- Use the existing shadcn components, `PageHeader`, `TableFrame` and query-state components. Everything is
  reachable by keyboard and has an accessible name.

## 12. Errors

Each condition gets one clear message the user can act on. None of them quotes payload content or secrets.

| Condition | Detected by | Message direction |
|---|---|---|
| SAM endpoint not running | connection refused on check/invoke | "Nothing is listening on 127.0.0.1:3001. Run `sam local start-lambda` or start it from KUI." |
| Endpoint isn't SAM | unexpected response to probe | "That port answers, but not like SAM local." |
| SAM CLI missing *(1.1)* | `sam --version` fails | Install link. |
| Docker unavailable *(1.1)* | SAM output / `docker info` fails | "SAM needs Docker running." |
| Function not found | 404 `ResourceNotFound` | Names the function, suggests `sam build` / re-discover. |
| Timeout | client timeout | States the timeout and that the container may still be running. |
| Function error | `X-Amz-Function-Error` | Shows `errorType` / `errorMessage`; status *function error*. |
| Invalid payload | builder / SAM 400 | Explains the raw-JSON rule (8.3). |
| Template parse error | discovery | File and line. |
| Kafka errors | consumer | The existing friendly Kafka connection messages. |

An Action whose consumer fails (e.g. the cluster is unreachable) moves to the *error* state with that message;
it doesn't retry silently in a loop.

## 13. Security

- Nothing from a Kafka message is ever executed or used to build a command, path or URL.
- Local processes start only from an explicit button press, with a fixed argument list, no shell, in a directory
  the user picked.
- Executor results, history and `actions.json` never contain cluster credentials or AWS credentials. KUI doesn't
  read AWS credentials at all.
- IPC input (endpoint URL, project path, timeouts, concurrency) is validated in Rust. Endpoints must be
  `http(s)`, and limits are clamped.
- Joining an existing consumer group and committing offsets need explicit confirmation (section 6).

## 14. Architecture fit

Follows `docs/CODE_STANDARDS.md`. Summary for reviewers:

- **Crate** `crates/kui_actions` (no Tauri, like `kui_kafka` and `kui_mql`): `model.rs` (IPC types),
  `validate.rs`, `discovery.rs` (templates), `payload.rs` (raw / MSK builders), `lambda.rs` (Invoke API client
  and response mapping), `executor.rs` (Action → consumer + plan), `run.rs` (run loop and bounded history).
- **App** `crates/kui_desktop/src/features/actions/`: thin commands, `actions.json` persistence and the
  managed `ActionsState`.
- **Executors** are an enum (`Executor::LocalLambda(..)`, later `Http(..)`) carrying config. The network call sits
  behind a small function or trait so tests use a fake. No generic plugin framework.
- **Running** reuses `Tasks` / `CancelToken` for Start/Stop and a Tauri `Channel` for history updates, like live
  tail and the data generator. The consumer polls through `run_blocking`. Invocations are async with a
  semaphore for concurrency.
- **Persistence**: `actions.json` in the app config dir through the existing `json_file` helper. Running state and
  history stay in memory.
- **Dependencies**: `reqwest` (already shipped) for invocation. One YAML parser is the only new dependency.
  Pick a maintained one that keeps unknown tags, and check it against the CI audit before adopting it.
- **Frontend** `frontend/features/actions/`: `api.ts` → `queries.ts` → `components/`, `types.ts` mirroring
  `model.rs`, a new route variant in the navigation store, and all calls through `callCommand` / `startStream`.

## 15. Acceptance criteria (Phase 1)

1. With `sam local start-lambda` running and the demo Kafka (`bun run kafka:up`), a user can create an Action for
   a discovered function, start it, produce a message, and see a succeeded row with the request, response and
   duration within 2 seconds of the function returning.
2. The same function receives a valid MSK event when MSK mode is selected.
3. Stopping SAM mid-run produces failed rows with the "not running" message, and the UI stays responsive.
4. A handler that sleeps longer than the timeout produces a timed-out row and the Action keeps processing.
5. Stop then Start resumes from the last committed offset; at most the in-flight messages are invoked again.
6. A topic producing large messages quickly doesn't grow KUI's memory without bound (history cap and byte budget).
7. No Action starts on app launch, and no offsets are committed except by a running Action.

## 16. Testing

- Unit: template discovery (YAML/JSON, Globals fallback, intrinsic tags, image functions, missing/oversized/bad
  files), MSK and raw payload builders (golden files), Lambda response mapping (success, function error, 404, 400,
  timeout), commit-offset planning under concurrency.
- Integration (existing Kafka integration tests): run an Action against a fake executor and check the invocations,
  commits and duplicate-on-restart behaviour.
- Security tests: history and `actions.json` contain no secret properties, and the process launcher takes no
  message-derived input.
- Manual / e2e smoke: a SAM sample project in `e2e/` (Node runtime for a small image) when Docker is available.

## 17. Open questions

1. Should Actions be per cluster in the sidebar (proposed) or a global page across clusters?
2. Persist history across restarts (e.g. last N per Action on disk), or keep it memory-only?
3. MSK batch size > 1: worth doing in Phase 1 for parity with real AWS behaviour, or later as proposed?
4. Keep Phase 1.1's "Start SAM from KUI", or rely on the developer's own terminal?
5. Phase 3: is the result of an Azure Functions call good enough when it only comes from host logs (section 9a,
   point 2)?

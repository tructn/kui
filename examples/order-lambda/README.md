# .NET order Lambda for KUI Actions

A small .NET 8 Lambda function to try [KUI Actions](../../docs/prd/kui-actions.md): KUI reads `demo.orders`
from the local Kafka, invokes the function, and shows each result. The function runs either under your debugger
(Visual Studio or Rider, through the AWS Lambda Test Tool) or in Docker through AWS SAM.

`OrderProcessor` (`OrderLambda::OrderLambda.OrderProcessor::FunctionHandler`, in `src/OrderLambda/Function.cs`
like AWS's .NET template) takes KUI's *AWS MSK event* payload as a `KafkaEvent`, the same type a real MSK trigger
delivers.

Each order gets a decision (`NEW` → `charge`, `PAID` → `ship`, `SHIPPED` → `done`). Orders over 450 throw, so
you also see what a function error looks like in KUI. The seeded topic has a few of them.

## Debug in Visual Studio

Each message stops at your breakpoints, with the real Kafka event in the Locals window.

You need the .NET 8 SDK and the Test Tool, once:

```bash
dotnet tool install -g Amazon.Lambda.TestTool --version 0.16.1
```

1. Start Kafka with the demo topics, from the KUI repo root: `bun run kafka:up`.
2. Start the Test Tool and leave it running:

   ```bash
   dotnet lambda-test-tool start --lambda-emulator-port 5050 --no-launch-window
   ```

3. Open `src/OrderLambda/OrderLambda.csproj` in Visual Studio and pick the **KUI OrderProcessor** launch profile
   next to the Start button, or in Rider on macOS or Linux pick **KUI OrderProcessor (macOS, Linux)**. Set a
   breakpoint in `OrderProcessor.FunctionHandler` and start debugging. The function connects to the Test Tool and
   waits for events.
4. In KUI, open **Actions** (⌘4) → **New action**:
   - **Runs in**: *Lambda Test Tool* (the default), endpoint `http://localhost:5050`.
   - **Function to invoke**: `OrderProcessor`.
   - **Timeout** stays at 900 seconds, so you can take your time at a breakpoint.
   - **Save and start**. The debugger stops at your breakpoint with the first message.

The profiles in `Properties/launchSettings.json` pin the Test Tool's version (0.16.1) in the path to its runtime
shim; if you install another version, change it there. KUI's editor shows the profile for your OS for any
function; type the handler there to get the class-library form.

Without an IDE, `make lambda` from the KUI repo root builds the function, starts the Test Tool unless it's
already running, and runs a launch profile (`PROFILE="KUI OrderProcessor"` picks the other one). By hand, run
this from `bin/Debug/net8.0` after `dotnet build`:

```bash
AWS_LAMBDA_RUNTIME_API=localhost:5050/OrderProcessor dotnet exec \
  --depsfile ./OrderLambda.deps.json --runtimeconfig ./OrderLambda.runtimeconfig.json \
  ~/.dotnet/tools/.store/amazon.lambda.testtool/0.16.1/amazon.lambda.testtool/0.16.1/content/Amazon.Lambda.RuntimeSupport/net8.0/Amazon.Lambda.RuntimeSupport.TestTool.dll \
  OrderLambda::OrderLambda.OrderProcessor::FunctionHandler
```

What to expect while debugging:

- KUI waits up to the timeout for each answer. Keep concurrency at 1 to get one message at a time.
- A message that gets no answer in time is recorded as timed out, and the action moves on. Stop while you're
  paused at a breakpoint and that message isn't committed, so it comes back on the next Start.
- An exception the handler throws is an answer: it's recorded as a function error and the action moves on.
- The name after the port in `AWS_LAMBDA_RUNTIME_API` must be the function name in KUI. With a different name the
  Test Tool queues the event for a function that never asks for it, and KUI times out.

## Run it with SAM

### You need

- Docker, running
- [AWS SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html)
  (`brew install aws-sam-cli` on macOS)
- .NET 8 SDK or newer, to build without a container

No AWS account or credentials: everything runs on your machine.

### Steps

1. Start Kafka with the demo topics, from the KUI repo root:

   ```bash
   bun run kafka:up
   ```

2. Build and serve the function, from this folder:

   ```bash
   sam build            # or: sam build --use-container, without a local .NET SDK
   sam local start-lambda
   ```

   It listens on `http://127.0.0.1:3001`. The first invocation pulls the .NET image, so it takes a while.

3. In KUI, open **Actions** (⌘4) → **New action**:
   - **Name**: `Process orders`. The consumer group becomes `kui-action-process-orders`.
   - **Topic**: `demo.orders`. Type to search the list.
   - **Start from**: *The oldest message*, to replay the 50 seeded orders, or *The next new message*.
   - **Runs in**: *AWS SAM CLI*. The timeout moves to 30 seconds; raise concurrency to run several at once.
   - **Function to invoke**: `OrderProcessor`, the logical ID in `template.yaml`.
   - **Save and start**. Each message arrives as an AWS MSK event.

4. Watch the history fill in. Open a row to see the request, the decoded message value, the response, or
   the error. To trigger more, produce to `demo.orders` from the topic's **Messages** tab, or use
   **Generate**.

Stop and Start again: the action resumes from its committed offsets.

## Without KUI

The same event, to check your SAM setup on its own:

```bash
sam local invoke OrderProcessor -e events/msk-event.json
```

`events/msk-event.json` is exactly what KUI sends in *AWS MSK event* mode. A test in `crates/kui_actions`
checks that, and `dotnet test` here checks that AWS's `KafkaEvent` type reads it:

```bash
dotnet test test/OrderLambda.Tests
```

## Notes

- The function is built for `arm64` (Apple silicon). On an x86 machine, change `Architectures` in
  `template.yaml` to `x86_64`.
- The MSK event and `MskClusterArn` in the template only matter if you deploy. Locally, KUI is the trigger
  and SAM ignores event sources.

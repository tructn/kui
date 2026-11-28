# .NET order Lambda for KUI Actions

Two small .NET 8 Lambda functions to try [KUI Actions](../../docs/prd/kui-actions.md): KUI reads `demo.orders`
from the local Kafka, invokes a function, and shows each result. The function runs either under your debugger
(Visual Studio or Rider, through the AWS Lambda Test Tool) or in Docker through AWS SAM.

| Function | KUI payload | Handler takes |
|---|---|---|
| `OrderProcessor` | AWS MSK event | `KafkaEvent`, the same type a real MSK trigger delivers |
| `RawOrderProcessor` | Message value | the order JSON |

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

3. Open `src/OrderLambda/OrderLambda.csproj` in Visual Studio, pick the **KUI OrderProcessor** launch profile
   next to the Start button, set a breakpoint in `HandleMsk` and press F5. The function connects to the Test
   Tool and waits for events.
4. In KUI, open **Actions** (⌘4) → **New action**:
   - **Runs in**: *Lambda Test Tool* (the default), endpoint `http://localhost:5050`.
   - **Project template**: choose this folder and pick `OrderProcessor`, or type the name.
   - **Debug mode** stays on.
   - **Save and start**. Visual Studio stops at your breakpoint with the first message.

The profiles in `Properties/launchSettings.json` pin the Test Tool's version (0.16.1) in the path to its runtime
shim; if you install another version, change it there. On macOS or Linux (Rider), replace `%USERPROFILE%` with
`$HOME`. KUI's editor shows the same profile for any function.

How debug mode behaves:

- One message at a time, and KUI waits up to 15 minutes for the answer, so take your time at a breakpoint.
- If a message gets no answer (you stopped debugging, or the function isn't running), the action stops *without
  committing it*. Start again and the same message comes back.
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

2. Build and serve the functions, from this folder:

   ```bash
   sam build            # or: sam build --use-container, without a local .NET SDK
   sam local start-lambda
   ```

   It listens on `http://127.0.0.1:3001`. The first invocation pulls the .NET image, so it takes a while.

3. In KUI, open **Actions** (⌘4) → **New action**:
   - **Name**: `Process orders`. The consumer group becomes `kui-action-process-orders`.
   - **Runs in**: *AWS SAM CLI*. Turn off **Debug mode** to run several messages at once.
   - **Start with**: *The whole topic*, to replay the 50 seeded orders, or *New messages*.
   - **SAM project**: choose this folder and pick `OrderProcessor`. KUI fills in the topic and the MSK
     payload from the template's MSK event.
   - **Save and start**.

4. Watch the history fill in. Open a row to see the request, the decoded message value, the response, or
   the error. To trigger more, produce to `demo.orders` from the topic's **Messages** tab, or use
   **Generate**.

Stop and Start again: the action resumes from its committed offsets.

## Without KUI

The same events, to check your SAM setup on its own:

```bash
sam local invoke OrderProcessor -e events/msk-event.json
sam local invoke RawOrderProcessor -e events/order.json
```

`events/msk-event.json` is exactly what KUI sends in *AWS MSK event* mode. A test in `crates/kui_actions`
checks that, and `dotnet test` here checks that AWS's `KafkaEvent` type reads it:

```bash
dotnet test test/OrderLambda.Tests
```

## Notes

- The functions are built for `arm64` (Apple silicon). On an x86 machine, change `Architectures` in
  `template.yaml` to `x86_64`.
- The MSK event and `MskClusterArn` in the template only matter if you deploy. Locally, KUI is the trigger
  and SAM ignores event sources.

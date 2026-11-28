import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { waitForPort } from "./ports.js";

/** The installed Test Tool version, since the shim path contains it. */
const TEST_TOOL_VERSION = "0.16.1";
/** KUI's default Test Tool endpoint, so the action editor's defaults are what gets tested. */
const PORT = 5050;
const TOOL_DIR = process.env.LAMBDA_TEST_TOOL_DIR ?? path.join(homedir(), ".dotnet/tools");
const SHIM = path.join(
  TOOL_DIR,
  `.store/amazon.lambda.testtool/${TEST_TOOL_VERSION}/amazon.lambda.testtool/${TEST_TOOL_VERSION}`,
  "content/Amazon.Lambda.RuntimeSupport/net8.0/Amazon.Lambda.RuntimeSupport.TestTool.dll",
);
/** Built by e2e/run-in-docker.sh. */
const BUILD = path.resolve(import.meta.dirname, "../examples/order-lambda/src/OrderLambda/bin/Release/net8.0");

export interface OrderLambda {
  endpoint: string;
  functionName: string;
  /** What the function has written to stdout so far: one log line per Kafka record it handled. */
  output: () => string;
  close: () => Promise<void>;
}

/**
 * Runs examples/order-lambda's `OrderProcessor` the way the README's Visual Studio profile does, without
 * the IDE: the AWS Lambda Test Tool serves the Invoke API, and the function polls it for events under its name.
 */
export async function startOrderLambda(): Promise<OrderLambda> {
  const functionName = "OrderProcessor";
  for (const [file, hint] of [
    [SHIM, `install Amazon.Lambda.TestTool ${TEST_TOOL_VERSION}`],
    [path.join(BUILD, "OrderLambda.dll"), "dotnet build examples/order-lambda/src/OrderLambda -c Release"],
  ]) {
    if (!existsSync(file)) throw new Error(`${file} is missing: ${hint}`);
  }

  const testTool = spawn(
    path.join(TOOL_DIR, "dotnet-lambda-test-tool"),
    ["start", "--lambda-emulator-port", String(PORT), "--no-launch-window"],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
  await Promise.race([waitForPort(PORT, "The Lambda Test Tool", 60_000), failOnSpawnError(testTool)]);

  // The function must start after the Test Tool listens: its runtime client gives up if the first poll fails.
  const fn = spawn(
    "dotnet",
    [
      "exec",
      "--depsfile",
      "./OrderLambda.deps.json",
      "--runtimeconfig",
      "./OrderLambda.runtimeconfig.json",
      SHIM,
      "OrderLambda::OrderLambda.OrderProcessor::FunctionHandler",
    ],
    {
      cwd: BUILD,
      env: { ...process.env, AWS_LAMBDA_RUNTIME_API: `localhost:${PORT}/${functionName}` },
      stdio: ["ignore", "pipe", "inherit"],
    },
  );
  let output = "";
  fn.stdout?.on("data", (chunk: Buffer) => {
    output += chunk.toString("utf8");
  });

  return {
    endpoint: `http://localhost:${PORT}`,
    functionName,
    output: () => output,
    close: async () => {
      await Promise.all([stop(fn), stop(testTool)]);
    },
  };
}

async function failOnSpawnError(child: ChildProcess): Promise<never> {
  const [error] = await once(child, "error");
  throw error;
}

async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill();
  await once(child, "exit");
}

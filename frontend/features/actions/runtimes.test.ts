import { describe, expect, test } from "bun:test";

import { newDraft } from "./draft";
import { launchProfile, RUNTIMES, targetFramework, withDebug, withRuntime } from "./runtimes";
import type { DiscoveredFunction, LambdaTarget } from "./types";

function target(patch: Partial<LambdaTarget> = {}): LambdaTarget {
  const { kind: _kind, ...lambda } = newDraft("local").executor;
  return { ...lambda, functionName: "OrderProcessor", ...patch };
}

function discovered(handler: string | null, runtime: string | null = "dotnet8"): DiscoveredFunction {
  return {
    logicalId: "OrderProcessor",
    resourceType: "AWS::Serverless::Function",
    functionName: { kind: "notSet" },
    runtime,
    handler,
    codeUri: null,
    packageType: null,
    kafkaTopics: [],
    metadata: {},
  };
}

describe("withRuntime", () => {
  test("moves a default endpoint to the new runtime's default", () => {
    expect(withRuntime(target({ runtime: "testTool", endpoint: RUNTIMES.testTool.endpoint }), "sam")).toEqual({
      runtime: "sam",
      endpoint: RUNTIMES.sam.endpoint,
    });
  });

  test("keeps an endpoint the user typed", () => {
    expect(withRuntime(target({ runtime: "sam", endpoint: "http://10.0.0.5:3001" }), "testTool")).toEqual({
      runtime: "testTool",
    });
  });
});

test("debug mode waits out breakpoints one message at a time", () => {
  expect(withDebug(true)).toEqual({ debug: true, timeoutSecs: 900, concurrency: 1 });
  expect(withDebug(false)).toEqual({ debug: false, timeoutSecs: 30 });
});

test("targetFramework maps SAM runtimes", () => {
  expect(targetFramework("dotnet8")).toBe("net8.0");
  expect(targetFramework("python3.12")).toBe("{TARGET_FRAMEWORK}");
  expect(targetFramework(null)).toBe("{TARGET_FRAMEWORK}");
});

describe("launchProfile", () => {
  test("runs a class-library handler under the Test Tool shim", () => {
    const json = JSON.parse(
      launchProfile(target({ runtime: "testTool", endpoint: "http://localhost:5050" }), discovered("OrderLambda::OrderLambda.Function::HandleMsk")),
    );
    const profile = json.profiles["KUI OrderProcessor"];
    expect(profile.commandName).toBe("Executable");
    expect(profile.workingDirectory).toBe(".\\bin\\$(Configuration)\\net8.0");
    expect(profile.commandLineArgs).toStartWith("exec --depsfile ./OrderLambda.deps.json --runtimeconfig ./OrderLambda.runtimeconfig.json ");
    expect(profile.commandLineArgs).toContain("/net8.0/Amazon.Lambda.RuntimeSupport.TestTool.dll ");
    expect(profile.commandLineArgs).toEndWith(" OrderLambda::OrderLambda.Function::HandleMsk");
    expect(profile.environmentVariables).toEqual({ AWS_LAMBDA_RUNTIME_API: "localhost:5050/OrderProcessor" });
  });

  test("an executable project or unknown handler only sets the variable, without a scheme", () => {
    for (const fn of [discovered("OrderLambda"), null]) {
      const json = JSON.parse(launchProfile(target({ endpoint: "http://127.0.0.1:6000/" }), fn));
      expect(json.profiles["KUI OrderProcessor"]).toEqual({
        commandName: "Project",
        environmentVariables: { AWS_LAMBDA_RUNTIME_API: "127.0.0.1:6000/OrderProcessor" },
      });
    }
  });
});

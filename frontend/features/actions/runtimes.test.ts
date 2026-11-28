import { describe, expect, test } from "bun:test";

import { newDraft } from "./draft";
import { hostOs, launchProfile, RUNTIMES, withRuntime } from "./runtimes";
import type { LambdaTarget } from "./types";

function target(patch: Partial<LambdaTarget> = {}): LambdaTarget {
  const { kind: _kind, ...lambda } = newDraft("local").executor;
  return { ...lambda, functionName: "OrderProcessor", ...patch };
}

describe("withRuntime", () => {
  test("moves a default endpoint and timeout to the new runtime's defaults", () => {
    expect(withRuntime(target(), "sam")).toEqual({
      runtime: "sam",
      endpoint: RUNTIMES.sam.endpoint,
      timeoutSecs: RUNTIMES.sam.timeoutSecs,
    });
  });

  test("keeps an endpoint and timeout the user changed", () => {
    expect(withRuntime(target({ runtime: "sam", endpoint: "http://10.0.0.5:3001", timeoutSecs: 60 }), "testTool")).toEqual({
      runtime: "testTool",
    });
  });
});

test("hostOs reads the webview's user agent", () => {
  expect(hostOs("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("windows");
  expect(hostOs("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe("unix");
  expect(hostOs("Mozilla/5.0 (X11; Linux x86_64)")).toBe("unix");
});

describe("launchProfile", () => {
  const handler = "OrderLambda::OrderLambda.OrderProcessor::FunctionHandler";

  test("runs a class-library handler under the Test Tool shim", () => {
    const json = JSON.parse(launchProfile(target({ endpoint: "http://localhost:5050" }), handler, "windows"));
    const profile = json.profiles["KUI OrderProcessor"];
    expect(profile.commandName).toBe("Executable");
    expect(profile.workingDirectory).toBe(".\\bin\\$(Configuration)\\{TARGET_FRAMEWORK}");
    expect(profile.commandLineArgs).toContain(" %USERPROFILE%/.dotnet/tools/");
    expect(profile.commandLineArgs).toStartWith("exec --depsfile ./OrderLambda.deps.json --runtimeconfig ./OrderLambda.runtimeconfig.json ");
    expect(profile.commandLineArgs).toEndWith(" OrderLambda::OrderLambda.OrderProcessor::FunctionHandler");
    expect(profile.environmentVariables).toEqual({ AWS_LAMBDA_RUNTIME_API: "localhost:5050/OrderProcessor" });
  });

  test("uses HOME and forward slashes outside Windows", () => {
    const profile = JSON.parse(launchProfile(target(), handler, "unix")).profiles["KUI OrderProcessor"];
    expect(profile.workingDirectory).toBe("bin/$(Configuration)/{TARGET_FRAMEWORK}");
    expect(profile.commandLineArgs).toContain(" %HOME%/.dotnet/tools/");
    expect(profile.commandLineArgs).not.toContain("USERPROFILE");
  });

  test("an executable project or no handler only sets the variable, without a scheme", () => {
    for (const h of ["OrderLambda", "  "]) {
      const json = JSON.parse(launchProfile(target({ endpoint: "http://127.0.0.1:6000/" }), h, "unix"));
      expect(json.profiles["KUI OrderProcessor"]).toEqual({
        commandName: "Project",
        environmentVariables: { AWS_LAMBDA_RUNTIME_API: "127.0.0.1:6000/OrderProcessor" },
      });
    }
  });
});

// What differs between the two local hosts of the Lambda Invoke API. KUI sends the same request to both; they differ
// in how the function runs, which decides whether the Visual Studio debugger can attach to it.
import type { LambdaRuntime, LambdaTarget } from "./types";

interface RuntimeInfo {
  title: string;
  description: string;
  endpoint: string;
  endpointLabel: string;
  /** A new Action's timeout: a function under a debugger may sit at a breakpoint for minutes. */
  timeoutSecs: number;
  startCommand: string;
  startWhere: string;
  readyText: string;
  functionHint: string;
}

export const RUNTIMES: Record<LambdaRuntime, RuntimeInfo> = {
  testTool: {
    title: "Lambda Test Tool",
    description: "Debug in Visual Studio or Rider",
    endpoint: "http://localhost:5050",
    endpointLabel: "Lambda Test Tool endpoint",
    timeoutSecs: 900,
    startCommand: "dotnet lambda-test-tool start --lambda-emulator-port 5050",
    startWhere: "Install it once with dotnet tool install -g Amazon.Lambda.TestTool, then run:",
    readyText: "The Lambda Test Tool is running",
    functionHint:
      "Any name you choose, as long as the function uses the same one after the port in AWS_LAMBDA_RUNTIME_API (localhost:5050/OrderProcessor → OrderProcessor). The launch profile below sets it for you. Not the handler.",
  },
  sam: {
    title: "AWS SAM CLI",
    description: "Runs your template in Docker",
    endpoint: "http://127.0.0.1:3001",
    endpointLabel: "SAM local endpoint",
    timeoutSecs: 30,
    startCommand: "sam build && sam local start-lambda",
    startWhere: "In your SAM project folder, run:",
    readyText: "SAM local is running",
    functionHint:
      "The function's logical ID in template.yaml, the key under Resources (OrderProcessor), not its Handler.",
  },
};

export const RUNTIME_ORDER: readonly LambdaRuntime[] = ["testTool", "sam"];

/** Switches the runtime, moving the endpoint and timeout along unless the user changed them. */
export function withRuntime(target: LambdaTarget, runtime: LambdaRuntime): Partial<LambdaTarget> {
  const from = RUNTIMES[target.runtime];
  const to = RUNTIMES[runtime];
  return {
    runtime,
    ...(target.endpoint.trim() === from.endpoint ? { endpoint: to.endpoint } : {}),
    ...(target.timeoutSecs === from.timeoutSecs ? { timeoutSecs: to.timeoutSecs } : {}),
  };
}

export type HostOs = "windows" | "unix";

export function hostOs(userAgent: string): HostOs {
  return userAgent.includes("Windows") ? "windows" : "unix";
}

/** The IDE that reads the profile: Visual Studio on Windows, Rider elsewhere. */
export function launchProfileIde(os: HostOs): string {
  return os === "windows" ? "Visual Studio" : "Rider";
}

/**
 * A launch profile that runs the function against the Test Tool. A class-library handler
 * (`Assembly::Type::Method`) runs under the Test Tool's runtime shim; an executable project just needs the variable.
 * Rider on macOS and Linux expands `%HOME%` but has no `%USERPROFILE%`, and needs `/` separators.
 */
export function launchProfile(target: LambdaTarget, handlerText: string, os: HostOs): string {
  const name = target.functionName || "{FUNCTION_NAME}";
  const environmentVariables = { AWS_LAMBDA_RUNTIME_API: `${hostOf(target.endpoint)}/${name}` };
  const handler = handlerText.trim();
  const assembly = handler.includes("::") ? handler.split("::")[0] : null;
  const framework = "{TARGET_FRAMEWORK}";
  const profile =
    assembly
      ? {
          commandName: "Executable",
          executablePath: "dotnet",
          workingDirectory: os === "windows" ? `.\\bin\\$(Configuration)\\${framework}` : `bin/$(Configuration)/${framework}`,
          commandLineArgs: [
            "exec",
            `--depsfile ./${assembly}.deps.json`,
            `--runtimeconfig ./${assembly}.runtimeconfig.json`,
            shimPath(framework, os),
            handler,
          ].join(" "),
          environmentVariables,
        }
      : { commandName: "Project", environmentVariables };
  return JSON.stringify({ profiles: { [`KUI ${name}`]: profile } }, null, 2);
}

function shimPath(framework: string, os: HostOs): string {
  const home = os === "windows" ? "%USERPROFILE%" : "%HOME%";
  const store = `${home}/.dotnet/tools/.store/amazon.lambda.testtool/{TEST_TOOL_VERSION}/amazon.lambda.testtool`;
  return `${store}/{TEST_TOOL_VERSION}/content/Amazon.Lambda.RuntimeSupport/${framework}/Amazon.Lambda.RuntimeSupport.TestTool.dll`;
}

/** `AWS_LAMBDA_RUNTIME_API` takes `host:port` without a scheme; the Test Tool fails to connect with one. */
function hostOf(endpoint: string): string {
  try {
    return new URL(endpoint.trim()).host;
  } catch {
    return "localhost:5050";
  }
}

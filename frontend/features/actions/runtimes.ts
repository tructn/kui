// What differs between the two local hosts of the Lambda Invoke API. KUI sends the same request to both; they differ
// in how the function runs, which decides whether the Visual Studio debugger can attach to it.
import type { DiscoveredFunction, LambdaRuntime, LambdaTarget } from "./types";

interface RuntimeInfo {
  title: string;
  description: string;
  endpoint: string;
  endpointLabel: string;
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
    startCommand: "dotnet lambda-test-tool start --lambda-emulator-port 5050",
    startWhere: "Install it once with dotnet tool install -g Amazon.Lambda.TestTool, then run:",
    readyText: "The Lambda Test Tool is running",
    functionHint: "The name after the port in the function's AWS_LAMBDA_RUNTIME_API.",
  },
  sam: {
    title: "AWS SAM CLI",
    description: "Runs your template in Docker",
    endpoint: "http://127.0.0.1:3001",
    endpointLabel: "SAM local endpoint",
    startCommand: "sam build && sam local start-lambda",
    startWhere: "In your SAM project folder, run:",
    readyText: "SAM local is running",
    functionHint: "The function's logical ID in the SAM template.",
  },
};

export const RUNTIME_ORDER: readonly LambdaRuntime[] = ["testTool", "sam"];

/** Switches the runtime, moving the endpoint along unless the user typed their own. */
export function withRuntime(target: LambdaTarget, runtime: LambdaRuntime): Partial<LambdaTarget> {
  const typedOwn = target.endpoint.trim() !== RUNTIMES[target.runtime].endpoint;
  return { runtime, ...(typedOwn ? {} : { endpoint: RUNTIMES[runtime].endpoint }) };
}

export const DEBUG_TIMEOUT_SECS = 900;
export const DEFAULT_TIMEOUT_SECS = 30;

/** Debug mode waits as long as Lambda allows, since a breakpoint holds the answer, and runs one message at a time. */
export function withDebug(debug: boolean): Partial<LambdaTarget> {
  return debug
    ? { debug, timeoutSecs: DEBUG_TIMEOUT_SECS, concurrency: 1 }
    : { debug, timeoutSecs: DEFAULT_TIMEOUT_SECS };
}

/** `dotnet8` from a SAM template becomes `net8.0`. */
export function targetFramework(runtime: string | null): string {
  const version = runtime?.match(/^dotnet(\d+)$/)?.[1];
  return version ? `net${version}.0` : "{TARGET_FRAMEWORK}";
}

/**
 * A Visual Studio launch profile that runs the function against the Test Tool. A class-library handler
 * (`Assembly::Type::Method`) runs under the Test Tool's runtime shim; an executable project just needs the variable.
 */
export function launchProfile(target: LambdaTarget, fn: DiscoveredFunction | null): string {
  const name = target.functionName || "{FUNCTION_NAME}";
  const environmentVariables = { AWS_LAMBDA_RUNTIME_API: `${hostOf(target.endpoint)}/${name}` };
  const handler = fn?.handler ?? null;
  const assembly = handler?.includes("::") ? handler.split("::")[0] : null;
  const profile =
    handler && assembly
      ? {
          commandName: "Executable",
          executablePath: "dotnet",
          workingDirectory: `.\\bin\\$(Configuration)\\${targetFramework(fn?.runtime ?? null)}`,
          commandLineArgs: [
            "exec",
            `--depsfile ./${assembly}.deps.json`,
            `--runtimeconfig ./${assembly}.runtimeconfig.json`,
            shimPath(targetFramework(fn?.runtime ?? null)),
            handler,
          ].join(" "),
          environmentVariables,
        }
      : { commandName: "Project", environmentVariables };
  return JSON.stringify({ profiles: { [`KUI ${name}`]: profile } }, null, 2);
}

function shimPath(framework: string): string {
  const store = "%USERPROFILE%/.dotnet/tools/.store/amazon.lambda.testtool/{TEST_TOOL_VERSION}/amazon.lambda.testtool";
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

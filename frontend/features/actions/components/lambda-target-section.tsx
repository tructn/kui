import { Alert02Icon, CheckmarkCircle02Icon, ReloadIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";

import { CopyButton } from "@/components/copy-button";
import { SegmentedControl } from "@/components/segmented-control";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useDebouncedValue } from "@/hooks/use-debounced-value";

import { isEndpoint } from "../draft";
import { useEndpointCheck } from "../queries";
import { hostOs, launchProfile, launchProfileIde, RUNTIME_ORDER, RUNTIMES, withRuntime } from "../runtimes";
import type { LambdaRuntime, LambdaTarget } from "../types";

interface LambdaTargetSectionProps {
  target: LambdaTarget;
  onChange: (patch: Partial<LambdaTarget>) => void;
  errors: { endpoint?: string; functionName?: string };
}

export function LambdaTargetSection({ target, onChange, errors }: LambdaTargetSectionProps) {
  const runtime = RUNTIMES[target.runtime];
  return (
    <FieldGroup>
      <Field>
        <FieldLabel>Runs in</FieldLabel>
        <SegmentedControl<LambdaRuntime>
          label="Runs in"
          fill
          value={target.runtime}
          onChange={(next) => onChange(withRuntime(target, next))}
          segments={RUNTIME_ORDER.map((id) => ({ value: id, label: RUNTIMES[id].title, description: RUNTIMES[id].description }))}
        />
      </Field>
      <EndpointField
        endpoint={target.endpoint}
        runtime={target.runtime}
        onChange={(endpoint) => onChange({ endpoint })}
        error={errors.endpoint}
      />
      <Field data-invalid={errors.functionName != null || undefined}>
        <FieldLabel htmlFor="action-function">Function to invoke</FieldLabel>
        <Input
          id="action-function"
          className="font-mono"
          placeholder="OrderProcessor"
          value={target.functionName}
          aria-invalid={errors.functionName != null}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => onChange({ functionName: e.target.value.trim() })}
        />
        {errors.functionName ? (
          <FieldError>{errors.functionName}</FieldError>
        ) : (
          <FieldDescription>{runtime.functionHint}</FieldDescription>
        )}
      </Field>
      {target.runtime === "testTool" && <LaunchProfile target={target} />}
    </FieldGroup>
  );
}

interface EndpointFieldProps {
  endpoint: string;
  runtime: LambdaRuntime;
  onChange: (v: string) => void;
  error?: string;
}

function EndpointField({ endpoint, runtime, onChange, error }: EndpointFieldProps) {
  const debounced = useDebouncedValue(endpoint.trim(), 400);
  const checkable = isEndpoint(debounced);
  const check = useEndpointCheck(checkable ? debounced : null, runtime);
  const info = RUNTIMES[runtime];

  return (
    <Field data-invalid={error != null || undefined}>
      <FieldLabel htmlFor="action-endpoint">{info.endpointLabel}</FieldLabel>
      <div className="flex gap-2">
        <Input
          id="action-endpoint"
          className="font-mono"
          value={endpoint}
          aria-invalid={error != null}
          aria-describedby="action-endpoint-status"
          onChange={(e) => onChange(e.target.value)}
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Check the endpoint again"
          disabled={!checkable}
          onClick={() => check.refetch()}
        >
          <HugeiconsIcon icon={ReloadIcon} className={check.isFetching ? "animate-spin" : undefined} />
        </Button>
      </div>
      <div id="action-endpoint-status" aria-live="polite" className="text-xs">
        {error ? (
          <FieldError>{error}</FieldError>
        ) : check.isFetching && !check.data ? (
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            <Spinner aria-hidden /> Checking…
          </span>
        ) : check.error ? (
          <span className="text-destructive">{check.error.message}</span>
        ) : check.data?.kind === "ready" ? (
          <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
            <HugeiconsIcon icon={CheckmarkCircle02Icon} className="size-3.5" aria-hidden /> {info.readyText}
          </span>
        ) : check.data ? (
          <div className="flex flex-col gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5">
            <span className="inline-flex items-start gap-1.5 text-amber-700 dark:text-amber-400">
              <HugeiconsIcon icon={Alert02Icon} className="mt-px size-3.5 shrink-0" aria-hidden /> {check.data.message}
            </span>
            <span className="text-muted-foreground">{info.startWhere}</span>
            <span className="flex items-center gap-1 rounded bg-muted px-2 py-1 font-mono">
              <span className="flex-1 truncate">{info.startCommand}</span>
              <CopyButton value={info.startCommand} label="Copy command" />
            </span>
          </div>
        ) : null}
      </div>
    </Field>
  );
}

const HOST_OS = hostOs(navigator.userAgent);

/** The IDE side of the Test Tool: the function must ask the Test Tool for events under the same name. */
function LaunchProfile({ target }: { target: LambdaTarget }) {
  // Only shapes the profile below, so it isn't saved with the Action.
  const [handler, setHandler] = useState("");
  const profile = launchProfile(target, handler, HOST_OS);

  return (
    <Field>
      <FieldLabel>{launchProfileIde(HOST_OS)} launch profile</FieldLabel>
      <Input
        id="action-handler"
        className="font-mono"
        placeholder="Handler, e.g. OrderLambda::OrderLambda.OrderProcessor::FunctionHandler (optional)"
        aria-label="Handler for the launch profile (optional)"
        value={handler}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => setHandler(e.target.value)}
      />
      <div className="relative rounded-md bg-muted">
        <pre className="max-h-64 overflow-auto p-3 pr-10 font-mono text-code">{profile}</pre>
        <div className="absolute top-1.5 right-1.5">
          <CopyButton value={profile} label="Copy launch profile" />
        </div>
      </div>
      <FieldDescription>
        Add to Properties/launchSettings.json, then press F5.
        {handler.includes("::") &&
          " Set {TARGET_FRAMEWORK} to your project's, like net8.0, and {TEST_TOOL_VERSION} from dotnet lambda-test-tool info."}
      </FieldDescription>
    </Field>
  );
}

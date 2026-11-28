import { Alert02Icon, CheckmarkCircle02Icon, Folder02Icon, ReloadIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { CopyButton } from "@/components/copy-button";
import { InfoTip } from "@/components/info-tip";
import { SegmentedControl } from "@/components/segmented-control";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useDebouncedValue } from "@/hooks/use-debounced-value";

import { isEndpoint } from "../draft";
import { useChooseProject, useDiscovery, useEndpointCheck } from "../queries";
import { launchProfile, RUNTIME_ORDER, RUNTIMES, withRuntime } from "../runtimes";
import type { DiscoveredFunction, LambdaRuntime, LambdaTarget } from "../types";
import { ChoiceCards } from "./choice-cards";

interface LambdaTargetSectionProps {
  target: LambdaTarget;
  onChange: (patch: Partial<LambdaTarget>) => void;
  onPick: (fn: DiscoveredFunction) => void;
  errors: { endpoint?: string; functionName?: string };
}

export function LambdaTargetSection({ target, onChange, onPick, errors }: LambdaTargetSectionProps) {
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
      <ProjectFunctions
        projectDir={target.projectDir}
        runtime={target.runtime}
        selected={target.functionName}
        onProjectDir={(projectDir) => onChange({ projectDir })}
        onPick={onPick}
      />
      <Field data-invalid={errors.functionName != null || undefined}>
        <div className="flex items-center gap-1.5">
          <FieldLabel htmlFor="action-function">Function to invoke</FieldLabel>
          <InfoTip label="About the function name">
            <span className="block max-w-64">{runtime.functionHint}</span>
          </InfoTip>
        </div>
        <Input
          id="action-function"
          className="font-mono"
          placeholder="OrderProcessor"
          value={target.functionName}
          aria-invalid={errors.functionName != null}
          onChange={(e) => onChange({ functionName: e.target.value.trim() })}
        />
        {errors.functionName && <FieldError>{errors.functionName}</FieldError>}
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

/** The Visual Studio side of the Test Tool: the function must ask the Test Tool for events under the same name. */
function LaunchProfile({ target }: { target: LambdaTarget }) {
  const discovery = useDiscovery(target.projectDir);
  const fn = discovery.data?.functions.find((f) => f.logicalId === target.functionName) ?? null;
  const profile = launchProfile(target, fn);

  return (
    <Field>
      <FieldLabel>Visual Studio launch profile</FieldLabel>
      <div className="relative rounded-md bg-muted">
        <pre className="max-h-64 overflow-auto p-3 pr-10 font-mono text-xs">{profile}</pre>
        <div className="absolute top-1.5 right-1.5">
          <CopyButton value={profile} label="Copy launch profile" />
        </div>
      </div>
      <FieldDescription>
        Add to Properties/launchSettings.json, then press F5.
        {profile.includes("{TEST_TOOL_VERSION}") && " Set {TEST_TOOL_VERSION} from dotnet lambda-test-tool info."}
      </FieldDescription>
    </Field>
  );
}

interface ProjectFunctionsProps {
  projectDir: string | null;
  runtime: LambdaRuntime;
  selected: string;
  onProjectDir: (dir: string) => void;
  onPick: (fn: DiscoveredFunction) => void;
}

function ProjectFunctions({ projectDir, runtime, selected, onProjectDir, onPick }: ProjectFunctionsProps) {
  const discovery = useDiscovery(projectDir);
  const choose = useChooseProject();
  const found = discovery.data;

  async function chooseFolder() {
    const picked = await choose.mutateAsync().catch(() => null);
    if (picked) onProjectDir(picked.projectDir);
  }

  return (
    <Field>
      <div className="flex items-center gap-1.5">
        <FieldLabel>{runtime === "sam" ? "SAM project" : "Project template (optional)"}</FieldLabel>
        <InfoTip label="About the project template">
          <span className="block max-w-64">
            KUI reads only the folder's template.yaml and lists its functions.
          </span>
        </InfoTip>
      </div>
      <div className="flex min-w-0 items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={chooseFolder} disabled={choose.isPending}>
          {choose.isPending ? <Spinner aria-hidden /> : <HugeiconsIcon icon={Folder02Icon} />}
          {projectDir ? "Change folder…" : "Choose folder…"}
        </Button>
        {projectDir && (
          <>
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground" title={projectDir}>
              {projectDir}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Read the template again"
              onClick={() => discovery.refetch()}
            >
              <HugeiconsIcon
                icon={ReloadIcon}
                className={discovery.isFetching ? "animate-spin" : undefined}
              />
            </Button>
          </>
        )}
      </div>
      {(choose.error ?? discovery.error) && <FieldError>{(choose.error ?? discovery.error)?.message}</FieldError>}
      {found && (
        <div className="flex flex-col gap-2">
          <span className="text-xs text-muted-foreground">
            {found.functions.length} function{found.functions.length === 1 ? "" : "s"} in{" "}
            <span className="font-mono">{found.template}</span>
          </span>
          {found.functions.length > 0 && (
            <ChoiceCards
              label="Discovered functions"
              columns={1}
              value={found.functions.some((f) => f.logicalId === selected) ? selected : null}
              onChange={(id) => {
                const fn = found.functions.find((f) => f.logicalId === id);
                if (fn) onPick(fn);
              }}
              choices={found.functions.map((fn) => ({
                value: fn.logicalId,
                title: (
                  <>
                    <span className="truncate font-mono">{fn.logicalId}</span>
                    {fn.runtime && <Badge variant="outline">{fn.runtime}</Badge>}
                    {fn.packageType === "Image" && <Badge variant="outline">Image</Badge>}
                  </>
                ),
                description: fn.handler && <span className="font-mono break-all">{fn.handler}</span>,
                extra: <FunctionNotes fn={fn} />,
              }))}
            />
          )}
          {found.skipped.map((note) => (
            <span key={note} className="text-xs text-muted-foreground">
              Skipped {note}
            </span>
          ))}
        </div>
      )}
    </Field>
  );
}

function FunctionNotes({ fn }: { fn: DiscoveredFunction }) {
  const name = fn.functionName;
  if (fn.kafkaTopics.length === 0 && name.kind !== "literal") return null;
  return (
    <span className="flex flex-wrap gap-1 pt-0.5">
      {fn.kafkaTopics.map((topic) => (
        <Badge key={topic} variant="secondary" className="font-mono">
          Kafka event · {topic}
        </Badge>
      ))}
      {name.kind === "literal" && (
        <Badge variant="outline" className="font-mono">
          FunctionName {name.value}
        </Badge>
      )}
    </span>
  );
}

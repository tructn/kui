import { Alert02Icon, PlayIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState, type FormEvent, type MouseEvent, type ReactNode } from "react";
import { toast } from "sonner";

import { InfoTip } from "@/components/info-tip";
import { ResizableSheetContent } from "@/components/resizable-sheet-content";
import { SegmentedControl } from "@/components/segmented-control";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { useConsumerGroups } from "@/features/consumer-groups";
import { useTopics } from "@/features/topics";

import { defaultGroupId, draftProblems, GROUP_PREFIX, MAX_CONCURRENCY, MAX_TIMEOUT_SECS, newDraft, suggestedPayload } from "../draft";
import { destinationOf, type ExecutorKind } from "../destinations";
import { useSaveAction, useStartAction } from "../queries";
import { withDebug } from "../runtimes";
import type { Action, DiscoveredFunction, LambdaTarget, PayloadFormat, Source, StartFrom } from "../types";
import { DestinationIcon } from "./destination-icon";
import { LambdaTargetSection } from "./lambda-target-section";

interface ActionEditorSheetProps {
  clusterId: string;
  open: boolean;
  /** The Action to edit; null creates one. */
  action: Action | null;
  /** Where a new Action sends messages; ignored when editing. */
  kind: ExecutorKind;
  onClose: () => void;
}

export function ActionEditorSheet({ clusterId, open, action, kind, onClose }: ActionEditorSheetProps) {
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <ResizableSheetContent panelId="action-editor" defaultWidth={720}>
        {open && <EditorForm clusterId={clusterId} action={action} kind={kind} onClose={onClose} />}
      </ResizableSheetContent>
    </Sheet>
  );
}

interface EditorFormProps {
  clusterId: string;
  action: Action | null;
  kind: ExecutorKind;
  onClose: () => void;
}

function EditorForm({ clusterId, action, kind, onClose }: EditorFormProps) {
  const [draft, setDraft] = useState<Action>(() => action ?? newDraft(clusterId, kind));
  // A new Action's group follows its name until the user edits the group.
  const [groupTouched, setGroupTouched] = useState(action != null);
  const [showErrors, setShowErrors] = useState(false);
  const [takeoverConfirmed, setTakeoverConfirmed] = useState(false);
  const topics = useTopics(clusterId);
  const groups = useConsumerGroups(clusterId);
  const save = useSaveAction(clusterId);
  const start = useStartAction(clusterId);

  const target = draft.executor;
  const destination = destinationOf(target);
  const problems = draftProblems(draft);
  const errors = showErrors ? problems : {};
  const topicNames = (topics.data ?? []).filter((t) => !t.internal).map((t) => t.name).sort();
  // Joining a group another application uses takes partitions away from it.
  const takesOverGroup =
    !draft.source.groupId.startsWith(GROUP_PREFIX) && (groups.data ?? []).some((g) => g.name === draft.source.groupId.trim());
  const busy = save.isPending || start.isPending;

  function setSource(patch: Partial<Source>) {
    setDraft((d) => ({ ...d, source: { ...d.source, ...patch } }));
  }
  function setTarget(patch: Partial<LambdaTarget>) {
    setDraft((d) => ({ ...d, executor: { ...d.executor, ...patch } }));
  }
  function setName(name: string) {
    setDraft((d) => ({ ...d, name, source: groupTouched ? d.source : { ...d.source, groupId: defaultGroupId(name) } }));
  }

  /** Fills in what the template says about the function: its name, payload shape and Kafka topic. */
  function pickFunction(fn: DiscoveredFunction) {
    setTarget({ functionName: fn.logicalId, payload: suggestedPayload(fn) });
    const topic = fn.kafkaTopics.find((t) => topicNames.includes(t));
    if (topic && !draft.source.topic) setSource({ topic });
    if (!draft.name.trim()) setName(fn.logicalId);
  }

  async function submit(event: FormEvent | MouseEvent, andStart: boolean) {
    event.preventDefault();
    setShowErrors(true);
    if (Object.keys(problems).length > 0 || (takesOverGroup && !takeoverConfirmed)) return;
    start.reset();
    try {
      const saved = await save.mutateAsync(draft);
      // A retry after a failed start must update this Action, not create a second one.
      setDraft((d) => ({ ...d, id: saved.id }));
      if (andStart) {
        await start.mutateAsync(saved.id);
        toast.success(`${saved.name} is running`, { description: "Produce a message to the topic to see it invoked." });
      } else {
        toast.success(`Saved ${saved.name}`);
      }
      onClose();
    } catch {
      // Shown below from the mutation's error; the sheet stays open to fix it.
    }
  }

  const failure = start.error
    ? `Saved, but it couldn't start: ${start.error.message}`
    : save.error?.message;

  return (
    <form onSubmit={(e) => submit(e, true)} className="flex min-h-0 flex-1 flex-col" noValidate>
      <SheetHeader className="flex-row items-center gap-3 border-b px-5 pr-12">
        <DestinationIcon id={destination.id} />
        <div className="flex flex-col gap-1">
          <SheetTitle>{action ? "Edit action" : "New action"}</SheetTitle>
          <SheetDescription className="text-xs">
            {destination.title} · {destination.runtime}
          </SheetDescription>
        </div>
      </SheetHeader>

      <fieldset disabled={busy} className="flex min-h-0 flex-1 flex-col divide-y overflow-y-auto px-5">
        <Section title="Source" description="The topic to read and the group that tracks progress.">
          <FieldGroup>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field data-invalid={errors.name != null || undefined}>
                <FieldLabel htmlFor="action-name">Name</FieldLabel>
                <Input
                  id="action-name"
                  placeholder="Process orders"
                  value={draft.name}
                  aria-invalid={errors.name != null}
                  autoFocus
                  onChange={(e) => setName(e.target.value)}
                />
                {errors.name && <FieldError>{errors.name}</FieldError>}
              </Field>
              <Field data-invalid={errors.topic != null || undefined}>
                <FieldLabel htmlFor="action-topic">Topic</FieldLabel>
                <Select value={draft.source.topic} onValueChange={(topic) => setSource({ topic })}>
                  <SelectTrigger id="action-topic" className="w-full font-mono" aria-invalid={errors.topic != null}>
                    <SelectValue placeholder={topics.isPending ? "Loading topics…" : "Choose a topic"} />
                  </SelectTrigger>
                  <SelectContent>
                    {topicNames.map((name) => (
                      <SelectItem key={name} value={name} className="font-mono">
                        {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.topic && <FieldError>{errors.topic}</FieldError>}
              </Field>
            </div>
            <Field>
              <LabelWithTip label="Start from" tip="Only the first run. After that the action resumes where it stopped." />
              <SegmentedControl<StartFrom>
                label="Start from"
                fill
                value={draft.source.startFrom}
                onChange={(startFrom) => setSource({ startFrom })}
                segments={[
                  { value: "latest", label: "New messages", description: "Messages produced after the first start" },
                  { value: "earliest", label: "The whole topic", description: "Every message still on the topic" },
                ]}
              />
            </Field>
            <Field data-invalid={errors.groupId != null || undefined}>
              <LabelWithTip
                htmlFor="action-group"
                label="Consumer group"
                tip="KUI joins this group and commits its offsets. A group of its own leaves your apps untouched."
              />
              <Input
                id="action-group"
                className="font-mono"
                value={draft.source.groupId}
                aria-invalid={errors.groupId != null}
                onChange={(e) => {
                  setGroupTouched(true);
                  setTakeoverConfirmed(false);
                  setSource({ groupId: e.target.value });
                }}
              />
              {errors.groupId && <FieldError>{errors.groupId}</FieldError>}
            </Field>
            {takesOverGroup && (
              <Alert className="border-amber-500/40">
                <HugeiconsIcon icon={Alert02Icon} className="text-amber-600" />
                <AlertTitle>This group already exists</AlertTitle>
                <AlertDescription className="flex flex-col gap-2">
                  <p>Joining it takes partitions from its other members, and KUI commits offsets for it.</p>
                  <label className="flex items-center gap-2 text-foreground">
                    <Checkbox checked={takeoverConfirmed} onCheckedChange={(v) => setTakeoverConfirmed(v === true)} />
                    Use this group anyway
                  </label>
                  {showErrors && !takeoverConfirmed && <FieldError>Confirm, or use a different group</FieldError>}
                </AlertDescription>
              </Alert>
            )}
          </FieldGroup>
        </Section>

        <TargetSettings target={target} onChange={setTarget} onPick={pickFunction} errors={errors} />

        <Section title="Run settings" description="How long each invocation may take and how many run at once.">
          <FieldGroup>
            <Field orientation="horizontal" className="rounded-lg border bg-muted/30 p-3">
              <FieldContent>
                <FieldLabel htmlFor="action-debug">Debug mode</FieldLabel>
                <FieldDescription>One message at a time, waiting up to 15 minutes at a breakpoint.</FieldDescription>
              </FieldContent>
              <Switch id="action-debug" checked={target.debug} onCheckedChange={(v) => setTarget(withDebug(v))} />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field data-invalid={errors.timeoutSecs != null || undefined}>
                <FieldLabel htmlFor="action-timeout">Timeout (seconds)</FieldLabel>
                <Input
                  id="action-timeout"
                  type="number"
                  min={1}
                  max={MAX_TIMEOUT_SECS}
                  className="font-mono"
                  value={Number.isNaN(target.timeoutSecs) ? "" : target.timeoutSecs}
                  onChange={(e) => setTarget({ timeoutSecs: e.target.valueAsNumber })}
                />
                {errors.timeoutSecs && <FieldError>{errors.timeoutSecs}</FieldError>}
              </Field>
              <Field data-invalid={errors.concurrency != null || undefined}>
                <LabelWithTip
                  htmlFor="action-concurrency"
                  label="Concurrency"
                  tip="1 keeps messages in order. Higher runs partitions side by side, each still in order. A message can run twice if KUI stops mid-invocation."
                />
                <Input
                  id="action-concurrency"
                  type="number"
                  min={1}
                  max={MAX_CONCURRENCY}
                  className="font-mono"
                  disabled={target.debug}
                  value={Number.isNaN(target.concurrency) ? "" : target.concurrency}
                  onChange={(e) => setTarget({ concurrency: e.target.valueAsNumber })}
                />
                {errors.concurrency && <FieldError>{errors.concurrency}</FieldError>}
              </Field>
            </div>
          </FieldGroup>
        </Section>

        {failure && <FieldError className="py-4">{failure}</FieldError>}
      </fieldset>

      <SheetFooter className="mt-0 flex-row justify-end border-t bg-muted/30 px-5">
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="button" variant="outline" disabled={busy} onClick={(e) => submit(e, false)}>
          Save
        </Button>
        <Button type="submit" disabled={busy}>
          <HugeiconsIcon icon={PlayIcon} /> Save and start
        </Button>
      </SheetFooter>
    </form>
  );
}

interface TargetSettingsProps {
  target: Action["executor"];
  onChange: (patch: Partial<LambdaTarget>) => void;
  onPick: (fn: DiscoveredFunction) => void;
  errors: { endpoint?: string; functionName?: string };
}

function TargetSettings({ target, onChange, onPick, errors }: TargetSettingsProps) {
  switch (target.kind) {
    case "localLambda":
      return (
        <>
          <Section title="Function" description="The local Lambda host and the function it invokes.">
            <LambdaTargetSection target={target} onChange={onChange} onPick={onPick} errors={errors} />
          </Section>
          <Section title="Payload" description="The request body each invocation receives.">
            <SegmentedControl<PayloadFormat>
              label="Payload"
              fill
              value={target.payload}
              onChange={(payload) => onChange({ payload })}
              segments={[
                { value: "msk", label: "AWS MSK event", description: "What an MSK trigger sends, one message per event" },
                { value: "raw", label: "Message value", description: "The value as is; it must be JSON" },
              ]}
            />
          </Section>
        </>
      );
  }
}

function LabelWithTip({ label, tip, htmlFor }: { label: string; tip: string; htmlFor?: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <FieldLabel htmlFor={htmlFor}>{label}</FieldLabel>
      <InfoTip label={`About ${label.toLowerCase()}`}>
        <span className="block max-w-64">{tip}</span>
      </InfoTip>
    </div>
  );
}

function Section({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  const id = `action-section-${title.toLowerCase().replace(/\s+/g, "-")}`;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4 py-6">
      <header className="flex flex-col gap-0.5">
        <h3 id={id} className="text-sm font-semibold">
          {title}
        </h3>
        <p className="text-xs text-muted-foreground">{description}</p>
      </header>
      {children}
    </section>
  );
}

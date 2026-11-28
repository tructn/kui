import { Alert02Icon, PlayIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState, type FormEvent, type MouseEvent, type ReactNode } from "react";
import { toast } from "sonner";

import { InfoTip } from "@/components/info-tip";
import { SearchableSelect } from "@/components/searchable-select";
import { SegmentedControl } from "@/components/segmented-control";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useConsumerGroups } from "@/features/consumer-groups";
import { useTopics } from "@/features/topics";
import { cn } from "@/lib/utils";

import { defaultGroupId, draftProblems, GROUP_PREFIX, MAX_CONCURRENCY, MAX_TIMEOUT_SECS, newDraft } from "../draft";
import { type ExecutorKind } from "../destinations";
import { useSaveAction, useStartAction } from "../queries";
import type { Action, LambdaTarget, Source, StartFrom } from "../types";
import { LambdaTargetSection } from "./lambda-target-section";

interface ActionEditorFormProps {
  clusterId: string;
  /** The Action to edit; null creates one. */
  action: Action | null;
  /** Where a new Action sends messages; ignored when editing. */
  kind: ExecutorKind;
  /** Rendered above the fields; the sheet and the detail page each bring their own. */
  header: ReactNode;
  /** Rendered after the fields in the scrolling area, outside the locked fieldset. */
  trailing?: ReactNode;
  /** Locks every field and button, e.g. while the Action runs. */
  locked?: boolean;
  autoFocus?: boolean;
  cancelLabel?: string;
  onCancel: () => void;
  onSaved?: (saved: Action) => void;
  className?: string;
}

export function ActionEditorForm({
  clusterId,
  action,
  kind,
  header,
  trailing,
  locked = false,
  autoFocus = false,
  cancelLabel = "Cancel",
  onCancel,
  onSaved,
  className,
}: ActionEditorFormProps) {
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
  const problems = draftProblems(draft);
  const errors = showErrors ? problems : {};
  const topicNames = (topics.data ?? []).filter((t) => !t.internal).map((t) => t.name).sort();
  // Joining a group another application uses takes partitions away from it.
  const takesOverGroup =
    !draft.source.groupId.startsWith(GROUP_PREFIX) && (groups.data ?? []).some((g) => g.name === draft.source.groupId.trim());
  const busy = save.isPending || start.isPending || locked;

  function setSource(patch: Partial<Source>) {
    setDraft((d) => ({ ...d, source: { ...d.source, ...patch } }));
  }
  function setTarget(patch: Partial<LambdaTarget>) {
    setDraft((d) => ({ ...d, executor: { ...d.executor, ...patch } }));
  }
  function setName(name: string) {
    setDraft((d) => ({ ...d, name, source: groupTouched ? d.source : { ...d.source, groupId: defaultGroupId(name) } }));
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
      onSaved?.(saved);
    } catch {
      // Shown below from the mutation's error; the form stays open to fix it.
    }
  }

  const failure = start.error
    ? `Saved, but it couldn't start: ${start.error.message}`
    : save.error?.message;

  return (
    <form onSubmit={(e) => submit(e, true)} className={cn("flex min-h-0 flex-1 flex-col", className)} noValidate>
      {header}

      <div className="flex min-h-0 flex-1 flex-col divide-y overflow-y-auto px-5">
        <fieldset disabled={busy} className="flex flex-col divide-y">
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
                    autoFocus={autoFocus}
                    onChange={(e) => setName(e.target.value)}
                  />
                  {errors.name && <FieldError>{errors.name}</FieldError>}
                </Field>
                <Field data-invalid={errors.topic != null || undefined}>
                  <FieldLabel htmlFor="action-topic">Topic</FieldLabel>
                  <SearchableSelect
                    id="action-topic"
                    className="font-mono"
                    value={draft.source.topic}
                    options={topicNames}
                    onChange={(topic) => setSource({ topic })}
                    placeholder={topics.isPending ? "Loading topics…" : "Choose a topic"}
                    searchLabel="Search topics"
                    emptyText={topics.isPending ? "Loading topics…" : "No matching topics."}
                    invalid={errors.topic != null}
                  />
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
                    { value: "latest", label: "The next new message", description: "Skips what's already on the topic" },
                    {
                      value: "earliest",
                      label: "The oldest message",
                      description: "Replays what's already on the topic, then keeps going",
                    },
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

          <TargetSettings target={target} onChange={setTarget} errors={errors} />

          <Section title="Run settings" description="How long each invocation may take and how many run at once.">
            <FieldGroup>
              <div className="grid grid-cols-2 gap-4">
                <Field data-invalid={errors.timeoutSecs != null || undefined}>
                  <LabelWithTip
                    htmlFor="action-timeout"
                    label="Timeout (seconds)"
                    tip={`Raise it while you step through the handler at a breakpoint, up to ${MAX_TIMEOUT_SECS} seconds.`}
                  />
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
        {trailing}
      </div>

      <div className="flex shrink-0 flex-row justify-end gap-2 border-t bg-muted/30 p-4 px-5">
        <Button type="button" variant="ghost" disabled={locked} onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button type="button" variant="outline" disabled={busy} onClick={(e) => submit(e, false)}>
          Save
        </Button>
        <Button type="submit" disabled={busy}>
          <HugeiconsIcon icon={PlayIcon} /> Save and start
        </Button>
      </div>
    </form>
  );
}

interface TargetSettingsProps {
  target: Action["executor"];
  onChange: (patch: Partial<LambdaTarget>) => void;
  errors: { endpoint?: string; functionName?: string };
}

function TargetSettings({ target, onChange, errors }: TargetSettingsProps) {
  switch (target.kind) {
    case "localLambda":
      return (
        <Section
          title="Function"
          description="The local Lambda host and the function it invokes. Each message arrives as an AWS MSK event."
        >
          <LambdaTargetSection target={target} onChange={onChange} errors={errors} />
        </Section>
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

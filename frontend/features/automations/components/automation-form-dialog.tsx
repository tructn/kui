import { ArrowRightIcon, SendIcon } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { leafPaths } from "@/lib/json-paths";
import { formatHeaderLines, parseHeaderLines } from "@/lib/http-headers";

import { isUnlocked, nextStage, STAGES, stageIssue, type StageId } from "../pipeline";
import { sourceGroups } from "../source-fields";
import { useSaveAutomation, useTestAutomation } from "../queries";
import type { Automation, Body } from "../types";
import { DataInspector, EMPTY_SAMPLE, type Sample } from "./data-inspector";
import { isBlankMapping } from "./field-mapping-editor";
import { StepRail } from "./pipeline-rail";
import { ExtractStage } from "./stages/extract-stage";
import { LoadStage } from "./stages/load-stage";
import { draftOf, TransformStage, type BodyDraft } from "./stages/transform-stage";

interface AutomationFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The automation to edit, or a blank one (see `emptyAutomation`) to create. */
  automation: Automation;
}

/** Nearly the whole window: the steps on the left, the one being set up in the middle, test data on the right. */
export function AutomationFormDialog({ open, onOpenChange, automation }: AutomationFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-none flex-col gap-0 p-0 sm:max-w-none">
        <DialogHeader className="sr-only">
          <DialogTitle>{automation.id ? "Edit automation" : "New automation"}</DialogTitle>
          <DialogDescription>Read messages from a topic, shape them and deliver them to a webhook.</DialogDescription>
        </DialogHeader>
        {/* Mounting the form only while open resets its state each time. */}
        {open && <AutomationForm initial={automation} onSaved={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function AutomationForm({ initial, onSaved }: { initial: Automation; onSaved: () => void }) {
  const [form, setForm] = useState(initial);
  const [headersText, setHeadersText] = useState(() => formatHeaderLines(initial.action.headers));
  const [draft, setDraft] = useState<BodyDraft>(() => draftOf(initial.action.body));
  const [sample, setSample] = useState<Sample>(EMPTY_SAMPLE);
  const [stage, setStage] = useState<StageId>("extract");
  // An automation being edited was already set up, so all its steps count as seen.
  const [visited, setVisited] = useState<ReadonlySet<StageId>>(
    () => new Set(initial.id ? STAGES.map((s) => s.id) : [stage]),
  );
  const [flagIssues, setFlagIssues] = useState(false);
  const save = useSaveAutomation();
  const test = useTestAutomation();

  const update = (patch: Partial<Automation>) => setForm((f) => ({ ...f, ...patch }));
  const updateAction = (patch: Partial<Automation["action"]>) =>
    setForm((f) => ({ ...f, action: { ...f.action, ...patch } }));

  const headers = useMemo(() => parseHeaderLines(headersText), [headersText]);
  const body = useMemo((): Body => {
    switch (draft.kind) {
      case "envelope":
        return { kind: "envelope" };
      case "mapping":
        return { kind: "mapping", fields: draft.fields.filter((f) => !isBlankMapping(f)) };
    }
  }, [draft]);
  const groups = useMemo(() => {
    let paths: string[] = [];
    try {
      paths = leafPaths(JSON.parse(sample.value));
    } catch {
      // Not JSON (yet): only the parts of a message are offered.
    }
    return sourceGroups(
      paths,
      sample.headers.map((h) => h.name),
    );
  }, [sample.value, sample.headers]);

  /** The form as the backend expects it: a blank filter becomes null, header lines become headers. */
  const automation = useMemo(
    (): Automation => ({
      ...form,
      query: form.query?.trim() ? form.query.trim() : null,
      action: { ...form.action, headers, body },
    }),
    [form, headers, body],
  );

  function select(next: StageId) {
    if (!isUnlocked(next, automation)) return;
    setStage(next);
    setVisited((v) => new Set(v).add(next));
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const unfinished = STAGES.find((s) => stageIssue(s.id, automation) !== null);
    if (unfinished) {
      setFlagIssues(true);
      select(unfinished.id);
      return;
    }
    save.mutate(automation, {
      onSuccess: (saved) => {
        toast.success(`Saved ${saved.name}`);
        onSaved();
      },
    });
  }

  function handleTest() {
    test.mutate(automation, {
      onSuccess: ({ status }) => toast.success(`The webhook answered ${status}`),
      onError: (e) => toast.error("Test failed", { description: e.message }),
    });
  }

  const issue = stageIssue(stage, automation);
  const next = nextStage(stage);

  return (
    <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 items-center gap-4 border-b px-6 py-3 pr-14">
        <Input
          aria-label="Name"
          required
          autoFocus
          className="h-9 flex-1 border-transparent bg-transparent px-2 text-base font-semibold shadow-none hover:border-input"
          placeholder="Name this automation, e.g. Alert on failed orders"
          value={form.name}
          onChange={(e) => update({ name: e.target.value })}
        />
        <label className="flex shrink-0 items-center gap-2 text-sm">
          <Switch checked={form.enabled} onCheckedChange={(enabled) => update({ enabled })} />
          Run while KUI is open
        </label>
      </header>

      <div className="grid min-h-0 flex-1 gap-6 overflow-y-auto px-6 py-5 lg:grid-cols-[15rem_minmax(0,1fr)_minmax(0,24rem)] lg:overflow-hidden">
        <StepRail automation={automation} active={stage} onSelect={select} visited={visited} flagIssues={flagIssues} />

        <section aria-label={`${STAGES.find((s) => s.id === stage)?.label} stage`} className="min-w-0 lg:overflow-y-auto lg:pr-2">
          {stage === "extract" && <ExtractStage automation={form} onChange={update} />}
          {stage === "transform" && <TransformStage draft={draft} onChange={setDraft} groups={groups} />}
          {stage === "load" && (
            <LoadStage
              automation={form}
              headersText={headersText}
              onHeadersTextChange={setHeadersText}
              onChange={update}
              onActionChange={updateAction}
            />
          )}
          {flagIssues && issue && (
            <p role="alert" className="mt-4 text-sm text-destructive">
              {issue}
            </p>
          )}
          {next && (
            <Button type="button" variant="outline" className="mt-6" disabled={issue !== null} onClick={() => select(next)}>
              Continue to {STAGES.find((s) => s.id === next)?.label} <ArrowRightIcon />
            </Button>
          )}
        </section>

        <aside aria-label="Test data" className="min-w-0 border-t pt-5 lg:overflow-y-auto lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6">
          <DataInspector
            clusterId={form.clusterId}
            topic={form.topic}
            name={form.name}
            body={body}
            method={form.action.method}
            url={form.action.url}
            headerNames={headers.map((h) => h.name)}
            sample={sample}
            onSampleChange={setSample}
          />
        </aside>
      </div>

      <footer className="flex shrink-0 items-center justify-between gap-4 border-t px-6 py-3">
        {save.error ? (
          <p role="alert" className="min-w-0 flex-1 text-sm break-words text-destructive">
            {save.error.message}
          </p>
        ) : (
          <span />
        )}
        <div className="flex shrink-0 gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={test.isPending || !form.action.url.trim()}
            onClick={handleTest}
          >
            {test.isPending ? <Spinner /> : <SendIcon />} Send test
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending && <Spinner />} Save
          </Button>
        </div>
      </footer>
    </form>
  );
}

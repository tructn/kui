import { PanelRightOpenIcon } from "lucide-react";
import { useMemo, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { HeightResizeHandle } from "@/components/height-resize-handle";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { useMessageSample } from "@/features/messages";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { formatHeaderLines, parseHeaderLines } from "@/lib/http-headers";

import { firstIssue, nodeIssue, SOURCE, type NodeRef } from "../pipeline";
import { useBodyPreview, useSaveAutomation, useTestAutomation } from "../queries";
import { contextOf, sampleOf, type SampleMessage } from "../sample-fields";
import { emptyRoute, type Action, type Automation, type FieldMapping, type PreviewSample, type Route } from "../types";
import { SourcePanel } from "./panels/source-panel";
import { TransformPanel } from "./panels/transform-panel";
import { WebhookPanel } from "./panels/webhook-panel";
import { PipelineCanvas } from "./pipeline-canvas";
import { RequestPreview } from "./request-preview";
import { SampleBar } from "./sample-bar";
import { SAMPLE_PANE_ID, SamplePane } from "./sample-pane";

const EMPTY_SAMPLE: SampleMessage = { value: "", key: "", headers: [] };
const MIN_CANVAS = 160;
/** Room kept for the selected step's settings below the canvas. */
const MIN_SETTINGS = 160;

interface AutomationFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The automation to edit, or a blank one (see `emptyAutomation`) to create. */
  automation: Automation;
}

/** Nearly the whole window: the pipeline as a graph on top, the selected box's settings below, the sample on demand. */
export function AutomationFormDialog({ open, onOpenChange, automation }: AutomationFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-none flex-col gap-0 p-0 sm:max-w-none">
        <DialogHeader className="sr-only">
          <DialogTitle>{automation.id ? "Edit pipeline" : "New pipeline"}</DialogTitle>
          <DialogDescription>Read messages from a topic, shape them and deliver them to webhooks.</DialogDescription>
        </DialogHeader>
        {/* Mounting the form only while open resets its state each time. */}
        {open && <AutomationForm initial={automation} onSaved={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

const byRoute = <T,>(routes: readonly Route[], value: (r: Route) => T): Record<string, T> =>
  Object.fromEntries(routes.map((r) => [r.id, value(r)]));

function AutomationForm({ initial, onSaved }: { initial: Automation; onSaved: () => void }) {
  const [form, setForm] = useState(initial);
  // Typed as text so a half-written header line isn't lost.
  const [headersText, setHeadersText] = useState(() => byRoute(initial.routes, (r) => formatHeaderLines(r.action.headers)));
  // Mapped fields, kept while a route is switched back to sending the whole message.
  const [kept, setKept] = useState(() =>
    byRoute(initial.routes, (r): FieldMapping[] => (r.action.body.kind === "mapping" ? r.action.body.fields : [])),
  );
  // A sample the user typed; until then the topic's newest message is used.
  const [edited, setEdited] = useState<SampleMessage | null>(null);
  const [selected, setSelected] = useState<NodeRef>(SOURCE);
  const [flagIssues, setFlagIssues] = useState(false);
  // Collapsed at first so the canvas and settings get the room; the sample is there when wanted.
  const [sampleOpen, setSampleOpen] = useState(false);
  // Null until the divider is dragged; the canvas then keeps that height.
  const [canvasHeight, setCanvasHeight] = useState<number | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const save = useSaveAutomation();
  const test = useTestAutomation();

  const update = (patch: Partial<Automation>) => setForm((f) => ({ ...f, ...patch }));
  const updateRoute = (id: string, change: (route: Route) => Route) =>
    setForm((f) => ({ ...f, routes: f.routes.map((r) => (r.id === id ? change(r) : r)) }));

  /** The form as the backend expects it: blank filters become null, header lines become headers. */
  const automation = useMemo(
    (): Automation => ({
      ...form,
      query: form.query?.trim() ? form.query.trim() : null,
      routes: form.routes.map((r) => ({
        ...r,
        query: r.query?.trim() ? r.query.trim() : null,
        action: { ...r.action, headers: parseHeaderLines(headersText[r.id] ?? "") },
      })),
    }),
    [form, headersText],
  );

  const route = selected.kind === "source" ? null : (automation.routes.find((r) => r.id === selected.route) ?? null);
  // A removed route's boxes are gone; show the topic instead.
  const shown: NodeRef = route ? selected : SOURCE;

  const topic = form.topic.trim();
  const latest = useMessageSample(form.clusterId, topic, topic !== "" && edited === null);
  const newest = useMemo(() => sampleOf(latest.data?.messages[0]), [latest.data]);
  const sample = edited ?? newest ?? EMPTY_SAMPLE;
  const context = useMemo(() => contextOf(sample, form.topic), [sample, form.topic]);
  const hasSample = sample.value.trim() !== "";
  const previewSample = useMemo(
    (): PreviewSample => ({ topic: form.topic, key: sample.key || null, value: sample.value || null, headers: sample.headers }),
    [form.topic, sample],
  );
  const request = useDebouncedValue(
    { name: form.name, body: route?.action.body ?? null, split: route?.split ?? null, sample: previewSample },
    400,
  );
  // Without a sample there is nothing to show, and "{}" would only mislead.
  const preview = useBodyPreview(
    request.name,
    request.body ?? { kind: "envelope" },
    request.split,
    request.sample,
    hasSample && request.body !== null,
  );
  const sent = useMemo(() => {
    if (!hasSample || !preview.data?.first) return undefined;
    try {
      return JSON.parse(preview.data.first) as unknown;
    } catch {
      return undefined;
    }
  }, [hasSample, preview.data]);

  function addRoute() {
    const added = emptyRoute(form.routes);
    update({ routes: [...form.routes, added] });
    setSelected({ kind: "transform", route: added.id });
  }

  function removeRoute(id: string) {
    update({ routes: form.routes.filter((r) => r.id !== id) });
    setSelected(SOURCE);
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const unfinished = firstIssue(automation);
    if (unfinished) {
      setFlagIssues(true);
      setSelected(unfinished.ref);
      return;
    }
    save.mutate(automation, {
      onSuccess: (saved) => {
        toast.success(`Saved ${saved.name}`);
        onSaved();
      },
    });
  }

  function handleTest(id: string) {
    const index = automation.routes.findIndex((r) => r.id === id);
    test.mutate(
      { automation, route: index, sample: hasSample ? previewSample : null },
      {
        onSuccess: ({ status }) => toast.success(`The webhook answered ${status}`),
        onError: (e) => toast.error("Test failed", { description: e.message }),
      },
    );
  }

  const sampleStatus = latest.isFetching ? "loading…" : edited ? "edited" : hasSample ? null : "none yet";
  const sampleBar = (
    <SampleBar
      topic={topic}
      sample={sample}
      edited={edited !== null}
      loading={latest.isFetching}
      onEdit={setEdited}
      onUseNewest={() => {
        setEdited(null);
        void latest.refetch();
      }}
    />
  );
  const requestPreview = route && (
    <RequestPreview
      preview={preview}
      split={request.split}
      method={route.action.method}
      url={route.action.url}
      headerNames={route.action.headers.map((h) => h.name)}
    />
  );
  const issue = flagIssues ? nodeIssue(automation, shown) : null;
  const index = route ? automation.routes.indexOf(route) + 1 : 0;
  const numbered = automation.routes.length > 1 ? ` ${index}` : "";

  return (
    <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 items-center gap-4 border-b px-6 py-3 pr-14">
        <Input
          aria-label="Name"
          required
          autoFocus
          className="h-9 flex-1 border-transparent bg-transparent px-2 text-base font-semibold shadow-none hover:border-input"
          placeholder="Name this pipeline, e.g. Alert on failed orders"
          value={form.name}
          onChange={(e) => update({ name: e.target.value })}
        />
        {!sampleOpen && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0"
            aria-expanded={false}
            aria-controls={SAMPLE_PANE_ID}
            onClick={() => setSampleOpen(true)}
          >
            <PanelRightOpenIcon /> Sample
            {sampleStatus && <span className="font-normal text-muted-foreground">· {sampleStatus}</span>}
          </Button>
        )}
        <label className="flex shrink-0 items-center gap-2 text-sm">
          <Switch checked={form.enabled} onCheckedChange={(enabled) => update({ enabled })} />
          Run while KUI is open
        </label>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Until dragged, grows with the routes so boxes stay readable instead of shrinking to fit. It may
              shrink when the window does, but the settings below keep their minimum. */}
          <div
            ref={canvasRef}
            className="bg-muted/20"
            style={{
              height: canvasHeight ?? `clamp(18rem, ${8 + automation.routes.length * 7}rem, 55vh)`,
              minHeight: MIN_CANVAS,
            }}
          >
            <PipelineCanvas
              automation={automation}
              selected={shown}
              onSelect={setSelected}
              flagIssues={flagIssues}
              onAddRoute={addRoute}
            />
          </div>
          <HeightResizeHandle
            target={canvasRef}
            height={canvasHeight}
            min={MIN_CANVAS}
            reserve={MIN_SETTINGS}
            onResize={setCanvasHeight}
            label="Resize the pipeline canvas"
          />

          <section
            aria-label="Selected step"
            className="flex-1 overflow-y-auto px-6 py-5"
            style={{ minHeight: MIN_SETTINGS }}
          >
            <h2 className="mb-4 text-sm font-medium">
              {shown.kind === "source" && "Topic"}
              {shown.kind === "transform" && `Transform${numbered}`}
              {shown.kind === "webhook" && `Webhook${numbered}`}
              <span className="font-normal text-muted-foreground">
                {shown.kind === "source" && " · what every route receives"}
                {shown.kind === "transform" && " · which messages this route takes, and what it sends"}
                {shown.kind === "webhook" && " · where this route sends it"}
              </span>
            </h2>
            {issue && (
              <p role="alert" className="mb-4 text-sm text-destructive">
                {issue}
              </p>
            )}
            {shown.kind === "source" && (
              <SourcePanel automation={form} onChange={update} />
            )}
            {shown.kind === "transform" && route && (
              <TransformPanel
                automation={form}
                route={route}
                onChange={(patch) => updateRoute(route.id, (r) => ({ ...r, ...patch }))}
                fields={kept[route.id] ?? []}
                onFieldsChange={(fields) => setKept((k) => ({ ...k, [route.id]: fields }))}
                onRemove={automation.routes.length > 1 ? () => removeRoute(route.id) : null}
                context={context}
                sent={sent}
                preview={requestPreview}
              />
            )}
            {shown.kind === "webhook" && route && (
              <WebhookPanel
                route={route}
                headersText={headersText[route.id] ?? ""}
                onHeadersTextChange={(text) => setHeadersText((h) => ({ ...h, [route.id]: text }))}
                onActionChange={(patch: Partial<Action>) => updateRoute(route.id, (r) => ({ ...r, action: { ...r.action, ...patch } }))}
                onTest={() => handleTest(route.id)}
                testing={test.isPending}
                preview={requestPreview}
              />
            )}
          </section>
        </div>
        {sampleOpen && <SamplePane sample={sample} sampleBar={sampleBar} onClose={() => setSampleOpen(false)} />}
      </div>

      <footer className="flex shrink-0 items-center justify-between gap-4 border-t px-6 py-3">
        {save.error ? (
          <p role="alert" className="min-w-0 flex-1 text-sm break-words text-destructive">
            {save.error.message}
          </p>
        ) : (
          <span className="text-xs text-muted-foreground">Click a box to set it up. Drag boxes to rearrange them.</span>
        )}
        <Button type="submit" disabled={save.isPending}>
          {save.isPending && <Spinner />} Save
        </Button>
      </footer>
    </form>
  );
}

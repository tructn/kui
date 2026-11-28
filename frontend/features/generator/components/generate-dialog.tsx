import { useQueryClient } from "@tanstack/react-query";
import { DiceIcon, StopIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { clusterKeys } from "@/features/clusters";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { formatNumber } from "@/lib/format";
import { formatKeyValueLines, parseKeyValueLines } from "@/lib/key-value";

import { generatorApi } from "../api";
import { inferStructures, type SampleRecord, type Structure } from "../infer";
import { PRESETS, type Preset } from "../presets";
import { usePreview } from "../queries";
import { LOCALES, type GenerateProgress, type Locale, type RecordTemplate } from "../types";
import { PlaceholderPicker } from "./placeholder-picker";
import { PresetPicker } from "./preset-picker";
import { RecordPreview } from "./record-preview";
import { StructurePicker } from "./structure-picker";
import { TemplateEditor, type TemplateEditorHandle } from "./template-editor";

const AUTO_PARTITION = "auto";

type Part = "value" | "key" | "headers";

interface GenerateDialogProps {
  clusterId: string;
  topic: string;
  partitions: number[];
  /** Messages already loaded for the topic, read when the dialog opens to learn its structure. */
  getSamples?: () => SampleRecord[];
}

/** The template as edited: key, value and headers as the text of their fields. */
interface Draft {
  key: string;
  value: string;
  headers: string;
}

interface Run {
  progress: GenerateProgress | null;
  cancel: () => void;
}

/** Fills a topic with fake data built from a `{{placeholder}}` template. */
export function GenerateDialog({ clusterId, topic, partitions, getSamples }: GenerateDialogProps) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [samples, setSamples] = useState<SampleRecord[]>([]);
  // Memoized: it walks every sampled message, and the dialog re-renders on each keystroke.
  const structures = useMemo(() => inferStructures(samples), [samples]);
  const sampled = structures.reduce((n, s) => n + s.count, 0);
  // Null until edited: the template then follows the topic's most common structure.
  const [draft, setDraft] = useState<Draft | null>(null);
  const current = draft ?? toDraft(structures[0]?.template ?? PRESETS[0].template);
  const { key, value, headers } = current;
  const edit = (patch: Partial<Draft>) => setDraft({ ...current, ...patch });
  const [part, setPart] = useState<Part>("value");
  const [locale, setLocale] = useState<Locale>("en");
  const [partition, setPartition] = useState(AUTO_PARTITION);
  const [count, setCount] = useState("1000");
  const [rate, setRate] = useState("");
  const [run, setRun] = useState<Run | null>(null);
  const [error, setError] = useState<string | null>(null);
  const editors = { value: useRef<TemplateEditorHandle>(null), headers: useRef<TemplateEditorHandle>(null) };
  const keyInput = useRef<HTMLInputElement>(null);

  // ⌘1/⌘K still navigate while the dialog is open, unmounting it mid-run. Stop
  // the Rust producer then, or it keeps writing with no Stop button left.
  const cancelRun = useRef<(() => void) | null>(null);
  useEffect(() => () => cancelRun.current?.(), []);

  const headerPairs = parseKeyValueLines(headers);
  const template: RecordTemplate = {
    key: key || null,
    value,
    headers: headerPairs.map(([k, v]) => ({ key: k, value: v })),
    locale,
  };
  const preview = usePreview(useDebouncedValue(template));
  const activePreset = PRESETS.find((p) => sameDraft(toDraft(p.template), current))?.label ?? null;
  const activeStructure = structures.find((s) => sameDraft(toDraft(s.template), current))?.id ?? null;

  function openChange(next: boolean) {
    // Closing mid-run would hide the Stop button, so keep the dialog open until it ends.
    if (run) return;
    // Read once per opening: the page on screen, not a new read from Kafka.
    if (next) setSamples(getSamples?.() ?? []);
    setOpen(next);
  }

  function apply(template: Preset["template"]) {
    setDraft(toDraft(template));
  }

  /** Inserts a placeholder at the cursor of whichever template tab is open. */
  function insertPlaceholder(snippet: string) {
    if (part !== "key") {
      editors[part].current?.insert(snippet);
      return;
    }
    const field = keyInput.current;
    const start = field?.selectionStart ?? key.length;
    const end = field?.selectionEnd ?? key.length;
    edit({ key: key.slice(0, start) + snippet + key.slice(end) });
    requestAnimationFrame(() => {
      field?.focus();
      field?.setSelectionRange(start + snippet.length, start + snippet.length);
    });
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const task = generatorApi.generate(
      clusterId,
      {
        topic,
        partition: partition === AUTO_PARTITION ? null : Number(partition),
        template,
        count: Number(count),
        rate: rate ? Number(rate) : null,
      },
      (progress) => setRun((r) => r && { ...r, progress }),
    );
    const cancel = () => void task.cancel();
    cancelRun.current = cancel;
    setRun({ progress: null, cancel });
    try {
      const done = await task.result;
      const took = done.elapsedMs < 1000 ? `${done.elapsedMs}ms` : `${(done.elapsedMs / 1000).toFixed(1)}s`;
      const stopped = done.sent + done.failed < done.total ? " (stopped)" : "";
      if (done.failed > 0) {
        toast.warning(`Produced ${formatNumber(done.sent)}, ${formatNumber(done.failed)} failed${stopped}`, {
          description: done.firstError ?? undefined,
        });
      } else {
        toast.success(`Produced ${formatNumber(done.sent)} messages in ${took}${stopped}`);
      }
      // Message counts and the browser are now stale.
      queryClient.invalidateQueries({ queryKey: clusterKeys.scope(clusterId) });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      cancelRun.current = null;
      setRun(null);
    }
  }

  const progress = run?.progress;
  const percent = progress ? ((progress.sent + progress.failed) / progress.total) * 100 : 0;

  return (
    <Dialog open={open} onOpenChange={openChange}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <HugeiconsIcon icon={DiceIcon} /> Generate
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Generate fake data</DialogTitle>
          <DialogDescription>
            {structures.length > 0
              ? "Starts from the shape of the topic's loaded messages. Pick another scenario or tweak the template, and send."
              : "Pick a scenario, tweak the template if you like, and send."}{" "}
            Producing to{" "}
            <span className="font-mono text-foreground">{topic}</span>.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col gap-4">
          {/* Only the body scrolls, so the header and the Generate button stay in view. */}
          <fieldset disabled={run != null} className="-mx-4 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4">
            {structures.length > 0 && (
              <StructurePicker
                structures={structures}
                sampled={sampled}
                active={activeStructure}
                onPick={(s: Structure) => apply(s.template)}
              />
            )}
            <PresetPicker presets={PRESETS} active={activePreset} onPick={(p) => apply(p.template)} />

            <div className="grid min-h-0 gap-6 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
              <Tabs value={part} onValueChange={(v) => setPart(v as Part)} className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <TabsList>
                    <TabsTrigger value="value">Value</TabsTrigger>
                    <TabsTrigger value="key">Key</TabsTrigger>
                    <TabsTrigger value="headers">
                      Headers
                      {headerPairs.length > 0 && (
                        <span className="text-xs text-muted-foreground tabular-nums">{headerPairs.length}</span>
                      )}
                    </TabsTrigger>
                  </TabsList>
                  <div className="ml-auto flex items-center gap-2">
                    <Select value={locale} onValueChange={(v) => setLocale(v as Locale)}>
                      <SelectTrigger size="sm" aria-label="Locale for names and addresses">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {LOCALES.map((l) => (
                          <SelectItem key={l.value} value={l.value}>
                            {l.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <PlaceholderPicker onInsert={insertPlaceholder} />
                  </div>
                </div>
                <TabsContent value="value">
                  <TemplateEditor
                    ref={editors.value}
                    aria-label="Value template"
                    className="h-[28rem]"
                    disabled={run != null}
                    value={value}
                    onChange={(v) => edit({ value: v })}
                  />
                </TabsContent>
                <TabsContent value="key" className="flex flex-col gap-2">
                  <Input
                    id="generate-key"
                    ref={keyInput}
                    aria-label="Key template"
                    className="font-mono"
                    placeholder="No key"
                    value={key}
                    onChange={(e) => edit({ key: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground">
                    Leave empty to send messages without a key. Records with the same key land on the same
                    partition.
                  </p>
                </TabsContent>
                <TabsContent value="headers" className="flex flex-col gap-2">
                  <TemplateEditor
                    ref={editors.headers}
                    aria-label="Header templates"
                    className="h-40"
                    placeholder="trace-id={{uuid}}"
                    disabled={run != null}
                    value={headers}
                    onChange={(v) => edit({ headers: v })}
                  />
                  <p className="text-xs text-muted-foreground">One name=template per line.</p>
                </TabsContent>
              </Tabs>

              <RecordPreview
                records={preview.data}
                error={preview.error}
                loading={preview.isFetching}
                stale={preview.isPlaceholderData}
                onShuffle={() => void preview.refetch()}
              />
            </div>
            {error && <FieldError>{error}</FieldError>}
          </fieldset>

          <DialogFooter className="items-center gap-4 sm:justify-between">
            {run ? (
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full bg-primary transition-[width]" style={{ width: `${percent}%` }} />
                </div>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {progress
                    ? `${formatNumber(progress.sent)} / ${formatNumber(progress.total)} sent` +
                      (progress.failed ? ` · ${formatNumber(progress.failed)} failed` : "")
                    : "Starting…"}
                </span>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <Label htmlFor="generate-count">Messages</Label>
                  <Input
                    id="generate-count"
                    type="number"
                    min={1}
                    max={10_000_000}
                    required
                    className="h-8 w-28 font-mono"
                    value={count}
                    onChange={(e) => setCount(e.target.value)}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Label htmlFor="generate-partition">Partition</Label>
                  <Select value={partition} onValueChange={setPartition}>
                    <SelectTrigger id="generate-partition" size="sm" className="min-w-24">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={AUTO_PARTITION}>Auto</SelectItem>
                      {partitions.map((p) => (
                        <SelectItem key={p} value={String(p)}>
                          {p}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2">
                  <Label htmlFor="generate-rate">Rate</Label>
                  <InputGroup className="h-8 w-32">
                    <InputGroupInput
                      id="generate-rate"
                      type="number"
                      min={1}
                      className="font-mono"
                      placeholder="Max"
                      value={rate}
                      onChange={(e) => setRate(e.target.value)}
                    />
                    <InputGroupAddon align="inline-end">
                      <InputGroupText>/s</InputGroupText>
                    </InputGroupAddon>
                  </InputGroup>
                </div>
              </div>
            )}
            {run ? (
              <Button type="button" variant="outline" onClick={run.cancel}>
                <HugeiconsIcon icon={StopIcon} /> Stop
              </Button>
            ) : (
              <Button type="submit" disabled={preview.error != null}>
                <HugeiconsIcon icon={DiceIcon} /> Generate {formatNumber(Number(count) || 0)}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function toDraft(template: Preset["template"]): Draft {
  return {
    key: template.key ?? "",
    value: template.value,
    headers: formatKeyValueLines(Object.fromEntries(template.headers.map((h) => [h.key, h.value]))),
  };
}

function sameDraft(a: Draft, b: Draft): boolean {
  return a.key === b.key && a.value === b.value && a.headers === b.headers;
}

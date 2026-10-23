import { useQueryClient } from "@tanstack/react-query";
import { SparklesIcon, SquareIcon } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
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
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { clusterKeys } from "@/features/clusters";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { formatNumber } from "@/lib/format";
import { formatKeyValueLines, parseKeyValueLines } from "@/lib/key-value";

import { generatorApi } from "../api";
import { PRESETS } from "../presets";
import { usePreview } from "../queries";
import { LOCALES, type GenerateProgress, type Locale, type RecordTemplate } from "../types";
import { PlaceholderList } from "./placeholder-list";
import { RecordPreview } from "./record-preview";

const AUTO_PARTITION = "auto";

interface GenerateDialogProps {
  clusterId: string;
  topic: string;
  partitions: number[];
}

interface Run {
  progress: GenerateProgress | null;
  cancel: () => void;
}

/** Fills a topic with fake data built from a `{{placeholder}}` template. */
export function GenerateDialog({ clusterId, topic, partitions }: GenerateDialogProps) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(PRESETS[0].template.key ?? "");
  const [value, setValue] = useState(PRESETS[0].template.value);
  const [headers, setHeaders] = useState(() => toHeaderLines(PRESETS[0].template.headers));
  const [locale, setLocale] = useState<Locale>("en");
  const [partition, setPartition] = useState(AUTO_PARTITION);
  const [count, setCount] = useState("1000");
  const [rate, setRate] = useState("");
  const [run, setRun] = useState<Run | null>(null);
  const [error, setError] = useState<string | null>(null);
  const valueRef = useRef<HTMLTextAreaElement>(null);

  // ⌘1/⌘K still navigate while the dialog is open, unmounting it mid-run. Stop
  // the Rust producer then, or it keeps writing with no Stop button left.
  const cancelRun = useRef<(() => void) | null>(null);
  useEffect(() => () => cancelRun.current?.(), []);

  const template: RecordTemplate = {
    key: key || null,
    value,
    headers: parseKeyValueLines(headers).map(([k, v]) => ({ key: k, value: v })),
    locale,
  };
  const preview = usePreview(useDebouncedValue(template));

  function applyPreset(label: string) {
    const preset = PRESETS.find((p) => p.label === label);
    if (!preset) return;
    setKey(preset.template.key ?? "");
    setValue(preset.template.value);
    setHeaders(toHeaderLines(preset.template.headers));
  }

  /** Inserts a placeholder at the cursor in the value editor. */
  function insertPlaceholder(snippet: string) {
    const area = valueRef.current;
    const [start, end] = area ? [area.selectionStart, area.selectionEnd] : [value.length, value.length];
    setValue(value.slice(0, start) + snippet + value.slice(end));
    requestAnimationFrame(() => {
      area?.focus();
      area?.setSelectionRange(start + snippet.length, start + snippet.length);
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
    // Closing mid-run would hide the Stop button, so keep the dialog open until it ends.
    <Dialog open={open} onOpenChange={(next) => (run ? undefined : setOpen(next))}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <SparklesIcon /> Generate
        </Button>
      </DialogTrigger>
      {/* Only the form body scrolls, so the header and the Generate button stay in view. */}
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Generate fake data</DialogTitle>
          <DialogDescription className="font-mono">{topic}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col gap-6">
          <div className="-mx-4 min-h-0 flex-1 overflow-y-auto px-4">
            <fieldset disabled={run != null} className="grid min-w-0 gap-6 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
              <FieldGroup>
                <div className="grid grid-cols-2 gap-4">
                  <Field>
                    <FieldLabel>Start from</FieldLabel>
                    <Select onValueChange={applyPreset}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Choose a preset…" />
                      </SelectTrigger>
                      <SelectContent>
                        {PRESETS.map((p) => (
                          <SelectItem key={p.label} value={p.label}>
                            {p.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field>
                    <FieldLabel>Locale</FieldLabel>
                    <Select value={locale} onValueChange={(v) => setLocale(v as Locale)}>
                      <SelectTrigger className="w-full">
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
                  </Field>
                </div>
                <Field>
                  <FieldLabel htmlFor="generate-key">Key template</FieldLabel>
                  <Input
                    id="generate-key"
                    className="font-mono"
                    placeholder="Empty = no key"
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="generate-value">Value template</FieldLabel>
                  <Textarea
                    id="generate-value"
                    ref={valueRef}
                    spellCheck={false}
                    className="min-h-64 font-mono text-code md:text-code"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="generate-headers">Headers</FieldLabel>
                  <Textarea
                    id="generate-headers"
                    spellCheck={false}
                    className="min-h-14 font-mono text-code md:text-code"
                    placeholder="trace-id={{uuid}}"
                    value={headers}
                    onChange={(e) => setHeaders(e.target.value)}
                  />
                  <FieldDescription>One key=template per line.</FieldDescription>
                </Field>
                <div className="grid grid-cols-3 gap-4">
                  <Field>
                    <FieldLabel htmlFor="generate-count">Messages</FieldLabel>
                    <Input
                      id="generate-count"
                      type="number"
                      min={1}
                      max={10_000_000}
                      required
                      className="font-mono"
                      value={count}
                      onChange={(e) => setCount(e.target.value)}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="generate-rate">Per second</FieldLabel>
                    <Input
                      id="generate-rate"
                      type="number"
                      min={1}
                      className="font-mono"
                      placeholder="Max"
                      value={rate}
                      onChange={(e) => setRate(e.target.value)}
                    />
                  </Field>
                  <Field>
                    <FieldLabel>Partition</FieldLabel>
                    <Select value={partition} onValueChange={setPartition}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={AUTO_PARTITION}>Auto</SelectItem>
                        {partitions.map((p) => (
                          <SelectItem key={p} value={String(p)}>
                            Partition {p}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
              </FieldGroup>

              <div className="flex min-w-0 flex-col gap-4">
                <RecordPreview
                  records={preview.data}
                  error={preview.error}
                  loading={preview.isFetching}
                  stale={preview.isPlaceholderData}
                />
                <PlaceholderList onInsert={insertPlaceholder} />
              </div>
            </fieldset>
            {error && <FieldError className="mt-4">{error}</FieldError>}
          </div>

          <DialogFooter className="items-center sm:justify-between">
            <div className="min-w-0 flex-1">
              {run && (
                <div className="flex flex-col gap-1.5">
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
              )}
            </div>
            {run ? (
              <Button type="button" variant="outline" onClick={run.cancel}>
                <SquareIcon /> Stop
              </Button>
            ) : (
              <Button type="submit" disabled={preview.error != null}>
                <SparklesIcon /> Generate {formatNumber(Number(count) || 0)}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function toHeaderLines(headers: { key: string; value: string }[]): string {
  return formatKeyValueLines(Object.fromEntries(headers.map((h) => [h.key, h.value])));
}

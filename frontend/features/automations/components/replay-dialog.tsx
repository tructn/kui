import { FileUpIcon, PlayIcon, SendIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatNumber } from "@/lib/format";

import { automationsApi } from "../api";
import { useReplay } from "../queries";
import {
  MAX_REPLAY_MESSAGES,
  type Automation,
  type LoadedMessages,
  type ReplayFrom,
  type ReplayItem,
  type ReplayReport,
  type ReplaySource,
} from "../types";

interface ReplayDialogProps {
  /** The automation to replay; null keeps the dialog closed. */
  automation: Automation | null;
  onClose: () => void;
}

type FromKind = ReplayFrom["kind"];

/** Runs a pipeline over messages that already exist, to see (or send) what it would have done. */
export function ReplayDialog({ automation, onClose }: ReplayDialogProps) {
  return (
    <Dialog open={automation !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[calc(100vh-4rem)] flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Replay {automation?.name}</DialogTitle>
          <DialogDescription>
            Run the pipeline over messages that already exist. A dry run only shows what each route would send.
          </DialogDescription>
        </DialogHeader>
        {automation && <ReplayForm automation={automation} />}
      </DialogContent>
    </Dialog>
  );
}

function ReplayForm({ automation }: { automation: Automation }) {
  const [sourceKind, setSourceKind] = useState<"topic" | "file">("topic");
  const [fromKind, setFromKind] = useState<FromKind>("latest");
  const [since, setSince] = useState("");
  const [limit, setLimit] = useState("100");
  const [file, setFile] = useState<LoadedMessages | null>(null);
  const [loading, setLoading] = useState(false);
  const replay = useReplay();

  const count = Number(limit);
  const sinceMillis = since ? new Date(since).getTime() : Number.NaN;
  const source: ReplaySource | null =
    sourceKind === "file"
      ? file && { kind: "messages", messages: file.messages }
      : !Number.isInteger(count) || count < 1 || count > MAX_REPLAY_MESSAGES
        ? null
        : fromKind === "timestamp"
          ? Number.isNaN(sinceMillis)
            ? null
            : { kind: "topic", from: { kind: "timestamp", millis: sinceMillis }, limit: count }
          : { kind: "topic", from: { kind: fromKind }, limit: count };

  async function chooseFile() {
    setLoading(true);
    try {
      const loaded = await automationsApi.loadReplayFile();
      if (loaded) setFile(loaded);
    } catch (e) {
      toast.error("Could not read the file", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setLoading(false);
    }
  }

  function run(send: boolean) {
    if (!source) return;
    replay.mutate(
      { automation, source, send },
      { onError: (e) => toast.error(send ? "Replay failed" : "Dry run failed", { description: e.message }) },
    );
  }

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <FieldGroup>
        <Tabs value={sourceKind} onValueChange={(v) => setSourceKind(v as "topic" | "file")}>
          <TabsList aria-label="Messages to replay">
            <TabsTrigger value="topic">From {automation.topic}</TabsTrigger>
            <TabsTrigger value="file">From an export file</TabsTrigger>
          </TabsList>
        </Tabs>
        {sourceKind === "topic" ? (
          <div className="grid grid-cols-[1fr_8rem] gap-3">
            <Field>
              <FieldLabel>Messages</FieldLabel>
              <div className="flex gap-2">
                <Select value={fromKind} onValueChange={(v) => setFromKind(v as FromKind)}>
                  <SelectTrigger className="w-44" aria-label="Messages">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="latest">The newest</SelectItem>
                    <SelectItem value="earliest">The oldest</SelectItem>
                    <SelectItem value="timestamp">From a time</SelectItem>
                  </SelectContent>
                </Select>
                {fromKind === "timestamp" && (
                  <Input
                    type="datetime-local"
                    aria-label="From"
                    value={since}
                    onChange={(e) => setSince(e.target.value)}
                  />
                )}
              </div>
            </Field>
            <Field>
              <FieldLabel htmlFor="replay-limit">How many</FieldLabel>
              <Input
                id="replay-limit"
                inputMode="numeric"
                value={limit}
                onChange={(e) => setLimit(e.target.value)}
              />
            </Field>
            <FieldDescription className="col-span-2">
              Up to {formatNumber(MAX_REPLAY_MESSAGES)} messages, replayed oldest first.
            </FieldDescription>
          </div>
        ) : (
          <Field>
            <div className="flex items-center gap-3">
              <Button type="button" variant="outline" disabled={loading} onClick={chooseFile}>
                {loading ? <Spinner /> : <FileUpIcon />} Choose file…
              </Button>
              <span className="text-sm text-muted-foreground">
                {file
                  ? file.total > file.messages.length
                    ? `The first ${formatNumber(file.messages.length)} of ${formatNumber(file.total)} messages`
                    : `${formatNumber(file.total)} messages`
                  : "No file chosen"}
              </span>
            </div>
            <FieldDescription>A JSON or NDJSON file from Export on the Messages page.</FieldDescription>
          </Field>
        )}
      </FieldGroup>

      {replay.data && <ReplayResults report={replay.data} />}

      <DialogFooter>
        <Button type="button" variant="outline" disabled={!source || replay.isPending} onClick={() => run(true)}>
          <SendIcon /> Replay and send
        </Button>
        <Button type="button" disabled={!source || replay.isPending} onClick={() => run(false)}>
          {replay.isPending ? <Spinner /> : <PlayIcon />} Dry run
        </Button>
      </DialogFooter>
      <p className="-mt-2 text-right text-xs text-muted-foreground">
        Replay and send calls the webhooks, at most {formatNumber(automation.maxPerMinute)} times (the pipeline's
        per-minute limit).
      </p>
    </div>
  );
}

function ReplayResults({ report }: { report: ReplayReport }) {
  const counts = [
    ["Read", report.read],
    ["Matched", report.matched],
    ["Requests", report.requests],
    ["Sent", report.sent],
    ["Failed", report.failed],
    ["Skipped", report.skipped],
  ] as const;
  return (
    <div className="flex min-h-0 flex-col gap-2">
      <dl className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
        {counts.map(([label, value]) => (
          <div key={label} className="flex gap-1.5">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="font-mono tabular-nums">{formatNumber(value)}</dd>
          </div>
        ))}
      </dl>
      <ol className="min-h-0 flex-1 space-y-2 overflow-auto rounded-md border p-2" aria-label="Requests">
        {report.items.map((item, i) => (
          <ReplayRow key={i} item={item} />
        ))}
        {report.items.length === 0 && (
          <li className="p-2 text-sm text-muted-foreground">No message matched the pipeline's filters.</li>
        )}
        {report.requests > report.items.length && (
          <li className="p-2 text-xs text-muted-foreground">
            The first {formatNumber(report.items.length)} of {formatNumber(report.requests)} requests are listed.
          </li>
        )}
      </ol>
    </div>
  );
}

function outcomeBadge(outcome: ReplayItem["outcome"]) {
  switch (outcome.kind) {
    case "planned":
      return <Badge variant="secondary">would send</Badge>;
    case "sent":
      return <Badge variant="outline">sent · {outcome.status}</Badge>;
    case "failed":
      return <Badge variant="destructive">failed</Badge>;
    case "skipped":
      return <Badge variant="secondary">skipped</Badge>;
  }
}

function ReplayRow({ item }: { item: ReplayItem }) {
  return (
    <li className="rounded-sm bg-muted/40 p-2">
      <div className="flex items-center gap-2 text-xs">
        <span className="font-mono text-muted-foreground">
          p{item.partition} · #{item.offset}
        </span>
        <span className="font-mono">{item.route}</span>
        {outcomeBadge(item.outcome)}
      </div>
      {item.outcome.kind === "failed" && <p className="mt-1 text-xs text-destructive">{item.outcome.error}</p>}
      {item.body && (
        <pre className="mt-1 max-h-32 overflow-auto font-mono text-xs break-all whitespace-pre-wrap">
          {item.body}
          {item.cut && "…"}
        </pre>
      )}
    </li>
  );
}

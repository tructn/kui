import { RotateCcwIcon, TriangleAlertIcon } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { DateTimePicker } from "@/components/date-time-picker";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

import { useResetOffsets, useResetPreview } from "../queries";
import type { OffsetChange, ResetRequest, ResetTo } from "../types";

const ALL_PARTITIONS = "all";

type Kind = ResetTo["kind"];

const TARGETS: { value: Kind; label: string }[] = [
  { value: "earliest", label: "Earliest (replay all retained)" },
  { value: "latest", label: "Latest (skip to the end)" },
  { value: "timestamp", label: "Time" },
  { value: "offset", label: "Offset" },
];

export interface ResetTopic {
  topic: string;
  partitions: number[];
}

interface ResetOffsetsDialogProps {
  clusterId: string;
  group: string;
  /** Topics the group reads, with their partitions. */
  topics: ResetTopic[];
  initialTopic: string;
  /** Kafka refuses a reset while any consumer is connected. */
  activeMembers: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Moves a group's committed offsets on one topic, e.g. back in time to replay
 * events after a bug fix. Shows every partition's current and new offset first.
 */
export function ResetOffsetsDialog({
  clusterId,
  group,
  topics,
  initialTopic,
  activeMembers,
  open,
  onOpenChange,
}: ResetOffsetsDialogProps) {
  const [topic, setTopic] = useState(initialTopic);
  const [partition, setPartition] = useState(ALL_PARTITIONS);
  const [kind, setKind] = useState<Kind>("earliest");
  const [offset, setOffset] = useState("0");
  const [time, setTime] = useState(() => new Date(Date.now() - 60 * 60 * 1000));
  const reset = useResetOffsets(clusterId);

  // Memoized on its parts so the debounce below only restarts when something changes.
  const request = useMemo<ResetRequest | null>(() => {
    const to = resetTo(kind, offset, time);
    if (!to) return null;
    return { group, topic, partitions: partition === ALL_PARTITIONS ? null : [Number(partition)], to };
  }, [group, topic, partition, kind, offset, time]);
  const debounced = useDebouncedValue(request, 300);
  const preview = useResetPreview(clusterId, open ? debounced : null);
  // Only trust a preview of exactly what would be submitted.
  const current = request != null && debounced === request && !preview.isPlaceholderData ? preview.data : undefined;

  const partitions = topics.find((t) => t.topic === topic)?.partitions ?? [];
  const busy = activeMembers > 0;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!request) return;
    reset.mutate(request, {
      onSuccess: (changes) => {
        toast.success(`Reset ${group} on ${topic}`, { description: summary(changes) });
        onOpenChange(false);
      },
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset.reset();
      }}
    >
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Reset offsets</DialogTitle>
          <DialogDescription>
            Moves where <span className="font-mono text-foreground">{group}</span> reads from next. Consumers that
            join afterwards start there. No messages are changed or deleted.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex min-w-0 flex-col gap-4">
          {busy && (
            <Alert variant="destructive">
              <TriangleAlertIcon />
              <AlertTitle>Stop the group's consumers first</AlertTitle>
              <AlertDescription>
                {activeMembers} {activeMembers === 1 ? "consumer is" : "consumers are"} connected. Kafka only accepts
                new offsets while none are, because a running consumer would overwrite them on its next commit.
              </AlertDescription>
            </Alert>
          )}
          <FieldGroup>
            <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-4">
              <Field className="min-w-0">
                <FieldLabel>Topic</FieldLabel>
                <Select
                  value={topic}
                  onValueChange={(t) => {
                    setTopic(t);
                    setPartition(ALL_PARTITIONS); // partition numbers differ per topic
                  }}
                >
                  <SelectTrigger className="w-full font-mono">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {topics.map((t) => (
                      <SelectItem key={t.topic} value={t.topic} className="font-mono">
                        {t.topic}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field className="min-w-0">
                <FieldLabel>Partition</FieldLabel>
                <Select value={partition} onValueChange={setPartition}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_PARTITIONS}>All partitions</SelectItem>
                    {partitions.map((p) => (
                      <SelectItem key={p} value={String(p)}>
                        Partition {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-4">
              <Field className="min-w-0">
                <FieldLabel>Reset to</FieldLabel>
                <Select value={kind} onValueChange={(v) => setKind(v as Kind)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TARGETS.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              {kind === "timestamp" && (
                <Field className="min-w-0">
                  <FieldLabel>First message at or after</FieldLabel>
                  <DateTimePicker label="Reset time" value={time} onChange={setTime} />
                </Field>
              )}
              {kind === "offset" && (
                <Field className="min-w-0">
                  <FieldLabel htmlFor="reset-offset">Offset</FieldLabel>
                  <Input
                    id="reset-offset"
                    type="number"
                    min={0}
                    className="font-mono"
                    value={offset}
                    onChange={(e) => setOffset(e.target.value)}
                    aria-invalid={request == null}
                  />
                </Field>
              )}
            </div>
          </FieldGroup>

          <ResetPreview changes={current} loading={request != null && !current && !preview.error} />
          {preview.error && <FieldError>{preview.error.message}</FieldError>}
          {reset.error && <FieldError>{reset.error.message}</FieldError>}

          <DialogFooter>
            <Button type="submit" disabled={busy || !current || current.length === 0 || reset.isPending}>
              {reset.isPending ? <Spinner /> : <RotateCcwIcon />}
              Reset {current ? `${current.length} ${current.length === 1 ? "partition" : "partitions"}` : "offsets"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Each partition's committed offset now and after the reset, and what that does to the backlog. */
function ResetPreview({ changes, loading }: { changes: OffsetChange[] | undefined; loading: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <p className="text-sm text-muted-foreground">
        {changes ? summary(changes) : loading ? "Working out the new offsets…" : "Pick where to reset to."}
      </p>
      <div className="max-h-64 overflow-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Partition</TableHead>
              <TableHead className="text-right">Current</TableHead>
              <TableHead className="text-right">New</TableHead>
              <TableHead className="text-right">Remaining after</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="font-mono text-xs tabular-nums">
            {changes?.map((c) => {
              const moved = c.current == null ? null : c.target - c.current;
              return (
                <TableRow key={c.partition}>
                  <TableCell>{c.partition}</TableCell>
                  <TableCell className="text-right">{c.current == null ? "—" : formatNumber(c.current)}</TableCell>
                  <TableCell
                    className={cn(
                      "text-right",
                      moved != null && moved < 0 && "text-amber-600 dark:text-amber-400",
                      moved != null && moved > 0 && "text-sky-600 dark:text-sky-400",
                    )}
                  >
                    {formatNumber(c.target)}
                  </TableCell>
                  <TableCell className="text-right">{formatNumber(c.high - c.target)}</TableCell>
                </TableRow>
              );
            })}
            {!changes &&
              loading &&
              Array.from({ length: 3 }, (_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={4}>
                    <Skeleton className="h-4 w-full" />
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

/** "Replays 1,200 messages" / "Skips 40 messages" / both, for the preview and the toast. */
function summary(changes: OffsetChange[]): string {
  let replayed = 0;
  let skipped = 0;
  for (const c of changes) {
    // A partition never committed to has no position to move from: count from its start.
    const from = c.current ?? c.low;
    if (c.target < from) replayed += from - c.target;
    else skipped += c.target - from;
  }
  const parts = [
    replayed > 0 && `replays ${formatNumber(replayed)} ${replayed === 1 ? "message" : "messages"}`,
    skipped > 0 && `skips ${formatNumber(skipped)} ${skipped === 1 ? "message" : "messages"}`,
  ].filter(Boolean) as string[];
  const text = parts.length ? parts.join(", ") : "nothing changes";
  return text[0].toUpperCase() + text.slice(1) + ".";
}

/** The request's target, or null while the typed offset isn't a whole number. */
function resetTo(kind: Kind, offset: string, time: Date): ResetTo | null {
  switch (kind) {
    case "earliest":
    case "latest":
      return { kind };
    case "timestamp":
      return { kind, value: time.getTime() };
    case "offset": {
      const value = Number(offset);
      return offset.trim() !== "" && Number.isInteger(value) && value >= 0 ? { kind, value } : null;
    }
  }
}

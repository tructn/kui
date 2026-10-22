import { DownloadIcon } from "lucide-react";
import { useState, type FormEvent } from "react";
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
import { Spinner } from "@/components/ui/spinner";
import { formatNumber } from "@/lib/format";

import { useExportMessages } from "../queries";
import type { BrowseRequest, ExportFormat, ExportSource, MessageRef } from "../types";

/** Mirrors `MAX_EXPORT` in `src-tauri/src/features/messages/service.rs`. */
const MAX_EXPORT = 100_000;
const DEFAULT_LIMIT = "10000";

const FORMATS: { value: ExportFormat; label: string; description: string }[] = [
  { value: "json", label: "JSON", description: "One array of messages." },
  { value: "ndjson", label: "NDJSON", description: "One message per line; easy to stream or grep." },
  { value: "csv", label: "CSV", description: "For spreadsheets. Headers are a JSON column." },
];

type Scope = "page" | "selected" | "range";

interface ExportMessagesDialogProps {
  clusterId: string;
  /** What the table shows now: filters, page size and the page's cursor. */
  request: BrowseRequest;
  /** Messages on the current page. */
  pageCount: number;
  /** Checked rows, if any. */
  selected: MessageRef[];
  disabled?: boolean;
}

/** Saves messages to a JSON, NDJSON or CSV file. The save window opens from the app itself. */
export function ExportMessagesDialog({ clusterId, request, pageCount, selected, disabled }: ExportMessagesDialogProps) {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<Scope>("page");
  const [format, setFormat] = useState<ExportFormat>("json");
  const [limit, setLimit] = useState(DEFAULT_LIMIT);
  const exporter = useExportMessages(clusterId);

  const limitValue = Number(limit);
  const limitValid = Number.isInteger(limitValue) && limitValue >= 1 && limitValue <= MAX_EXPORT;
  const count = scope === "page" ? pageCount : scope === "selected" ? selected.length : null;
  const canExport = scope === "range" ? limitValid : (count ?? 0) > 0;

  function changeOpen(next: boolean) {
    setOpen(next);
    if (next) setScope(selected.length > 0 ? "selected" : "page");
    else exporter.reset();
  }

  function source(): ExportSource {
    if (scope === "selected") return { kind: "messages", topic: request.topic, messages: selected };
    if (scope === "page") return { kind: "range", browse: request, limit: pageCount };
    return { kind: "range", browse: { ...request, cursor: null }, limit: limitValue };
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    exporter.mutate(
      { source: source(), format },
      {
        onSuccess: (exported) => {
          if (!exported) return; // the save window was cancelled
          toast.success(`Exported ${formatNumber(exported.count)} ${exported.count === 1 ? "message" : "messages"}`, {
            description: exported.path,
          });
          setOpen(false);
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled}>
          <DownloadIcon /> Export
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Export messages</DialogTitle>
          <DialogDescription className="font-mono [overflow-wrap:anywhere]">from {request.topic}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
          <FieldGroup>
            <Field>
              <FieldLabel>Messages</FieldLabel>
              <Select value={scope} onValueChange={(v) => setScope(v as Scope)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="page">This page ({formatNumber(pageCount)})</SelectItem>
                  {selected.length > 0 && (
                    <SelectItem value="selected">Selected ({formatNumber(selected.length)})</SelectItem>
                  )}
                  <SelectItem value="range">{rangeLabel(request)}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            {scope === "range" && (
              <Field>
                <FieldLabel htmlFor="export-limit">At most</FieldLabel>
                <Input
                  id="export-limit"
                  type="number"
                  min={1}
                  max={MAX_EXPORT}
                  className="font-mono"
                  value={limit}
                  onChange={(e) => setLimit(e.target.value)}
                  aria-invalid={!limitValid}
                />
                <FieldDescription>
                  Uses the partition and start filters. Up to {formatNumber(MAX_EXPORT)} messages.
                </FieldDescription>
              </Field>
            )}
            <Field>
              <FieldLabel>Format</FieldLabel>
              <Select value={format} onValueChange={(v) => setFormat(v as ExportFormat)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FORMATS.map((f) => (
                    <SelectItem key={f.value} value={f.value}>
                      {f.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription>
                {FORMATS.find((f) => f.value === format)?.description} Binary keys and values are saved as hex.
              </FieldDescription>
            </Field>
            {exporter.error && <FieldError>{exporter.error.message}</FieldError>}
          </FieldGroup>
          <DialogFooter>
            <Button type="submit" disabled={!canExport || exporter.isPending}>
              {exporter.isPending ? <Spinner /> : <DownloadIcon />}
              {exporter.isPending ? "Exporting…" : "Save as…"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The "everything matching" option, worded after where the browse starts. */
function rangeLabel(request: BrowseRequest): string {
  const where = request.partition == null ? "" : ` on partition ${request.partition}`;
  switch (request.from) {
    case "latest":
      return `Newest first${where}`;
    case "earliest":
      return `Oldest first${where}`;
    case "offset":
      return `From offset ${request.value ?? 0}${where}`;
    case "timestamp":
      return `From ${request.value == null ? "the chosen time" : new Date(request.value).toLocaleString()}${where}`;
  }
}

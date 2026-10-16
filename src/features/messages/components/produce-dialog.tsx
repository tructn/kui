import { SendIcon } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { prettyJson } from "@/lib/format";
import { parseKeyValueLines } from "@/lib/key-value";

import { useProduceMessage, useSubjectSchema, useSubjects } from "../queries";
import type { SubjectSchema } from "../types";

const AUTO_PARTITION = "auto";

type ValueFormat = "text" | "schema";

const SCHEMA_TYPE_LABELS: Record<SubjectSchema["schemaType"], string> = {
  AVRO: "Avro",
  PROTOBUF: "Protobuf",
  JSON: "JSON Schema",
};

interface ProduceDialogProps {
  clusterId: string;
  topic: string;
  partitions: number[];
}

export function ProduceDialog({ clusterId, topic, partitions }: ProduceDialogProps) {
  const [open, setOpen] = useState(false);
  const [partition, setPartition] = useState(AUTO_PARTITION);
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [headers, setHeaders] = useState("");
  const [format, setFormat] = useState<ValueFormat>("text");
  const [pickedSubject, setSubject] = useState<string | null>(null);
  const [pickedMessage, setMessage] = useState<string | null>(null);
  const produce = useProduceMessage(clusterId);

  const usesSchema = format === "schema";
  const subjects = useSubjects(clusterId, open && usesSchema);
  // Registry serializers name a topic's value subject `<topic>-value`, so start there.
  const subject = pickedSubject ?? subjects.data?.find((s) => s === `${topic}-value`) ?? null;
  const schema = useSubjectSchema(clusterId, usesSchema ? subject : null);
  const messages = schema.data?.messages ?? [];
  const message = pickedMessage != null && messages.includes(pickedMessage) ? pickedMessage : (messages[0] ?? null);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    produce.mutate(
      {
        topic,
        partition: partition === AUTO_PARTITION ? null : Number(partition),
        key: key || null,
        value,
        headers: parseKeyValueLines(headers).map(([k, v]) => ({ key: k, value: v })),
        valueSchema: usesSchema && subject ? { subject, message } : null,
      },
      {
        onSuccess: (d) => {
          toast.success(`Produced to partition ${d.partition} at offset ${d.offset}`);
          setValue(""); // keep key/headers for quickly sending similar messages
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <SendIcon /> Produce
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Produce message</DialogTitle>
          <DialogDescription className="font-mono">{topic}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
          <FieldGroup>
            <div className="grid grid-cols-[1fr_2fr] gap-4">
              <Field>
                <FieldLabel>Partition</FieldLabel>
                <Select value={partition} onValueChange={setPartition}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={AUTO_PARTITION}>Auto (by key)</SelectItem>
                    {partitions.map((p) => (
                      <SelectItem key={p} value={String(p)}>
                        Partition {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="produce-key">Key</FieldLabel>
                <Input id="produce-key" className="font-mono" value={key} onChange={(e) => setKey(e.target.value)} />
              </Field>
            </div>
            <div className="grid grid-cols-[1fr_2fr] gap-4">
              <Field>
                <FieldLabel>Value format</FieldLabel>
                <Select value={format} onValueChange={(v) => setFormat(v as ValueFormat)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="text">Text</SelectItem>
                    <SelectItem value="schema">Schema Registry</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              {usesSchema && (
                <Field>
                  <FieldLabel>Subject</FieldLabel>
                  <Select value={subject ?? ""} onValueChange={setSubject} disabled={!subjects.data}>
                    <SelectTrigger className="w-full font-mono">
                      <SelectValue placeholder={subjects.isPending ? "Loading…" : "Choose a subject"} />
                    </SelectTrigger>
                    <SelectContent>
                      {subjects.data?.map((s) => (
                        <SelectItem key={s} value={s} className="font-mono">
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}
            </div>
            {usesSchema && subjects.error && <FieldError>{subjects.error.message}</FieldError>}
            {usesSchema && schema.error && <FieldError>{schema.error.message}</FieldError>}
            {usesSchema && messages.length > 1 && (
              <Field>
                <FieldLabel>Message type</FieldLabel>
                <Select value={message ?? ""} onValueChange={setMessage}>
                  <SelectTrigger className="w-full font-mono">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {messages.map((m) => (
                      <SelectItem key={m} value={m} className="font-mono">
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
            {usesSchema && schema.data && (
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground">
                  {SCHEMA_TYPE_LABELS[schema.data.schemaType]} schema · version {schema.data.version} · id{" "}
                  {schema.data.id}
                </summary>
                <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-muted p-3 font-mono whitespace-pre-wrap">
                  {schema.data.schemaType === "PROTOBUF" ? schema.data.schema : prettyJson(schema.data.schema)}
                </pre>
              </details>
            )}
            <Field>
              <FieldLabel htmlFor="produce-value">Value</FieldLabel>
              <Textarea
                id="produce-value"
                className="min-h-40 font-mono text-xs"
                placeholder='{"hello": "kafka"}'
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
              {usesSchema && (
                <FieldDescription>
                  JSON matching the schema; it's encoded with the subject's latest version.
                </FieldDescription>
              )}
            </Field>
            <Field>
              <FieldLabel htmlFor="produce-headers">Headers</FieldLabel>
              <Textarea
                id="produce-headers"
                className="min-h-16 font-mono text-xs"
                placeholder="content-type=application/json"
                value={headers}
                onChange={(e) => setHeaders(e.target.value)}
              />
              <FieldDescription>One key=value per line.</FieldDescription>
            </Field>
            {produce.error && <FieldError>{produce.error.message}</FieldError>}
          </FieldGroup>
          <DialogFooter>
            <Button type="submit" disabled={produce.isPending || (usesSchema && !schema.data)}>
              {produce.isPending ? <Spinner /> : <SendIcon />} Send
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

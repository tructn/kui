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
import { parseKeyValueLines } from "@/lib/key-value";

import { useProduceMessage } from "../queries";

const AUTO_PARTITION = "auto";

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
  const produce = useProduceMessage(clusterId);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    produce.mutate(
      {
        topic,
        partition: partition === AUTO_PARTITION ? null : Number(partition),
        key: key || null,
        value,
        headers: parseKeyValueLines(headers).map(([k, v]) => ({ key: k, value: v })),
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
            <Field>
              <FieldLabel htmlFor="produce-value">Value</FieldLabel>
              <Textarea
                id="produce-value"
                className="min-h-40 font-mono text-code md:text-code"
                placeholder='{"hello": "kafka"}'
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="produce-headers">Headers</FieldLabel>
              <Textarea
                id="produce-headers"
                className="min-h-16 font-mono text-code md:text-code"
                placeholder="content-type=application/json"
                value={headers}
                onChange={(e) => setHeaders(e.target.value)}
              />
              <FieldDescription>One key=value per line.</FieldDescription>
            </Field>
            {produce.error && <FieldError>{produce.error.message}</FieldError>}
          </FieldGroup>
          <DialogFooter>
            <Button type="submit" disabled={produce.isPending}>
              {produce.isPending ? <Spinner /> : <SendIcon />} Send
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

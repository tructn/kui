import { ForwardIcon } from "lucide-react";
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
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";

import { useCopyMessages } from "../queries";
import type { CopyTarget, MessageRef } from "../types";
import { TopicPicker } from "./topic-picker";

const AUTO_PARTITION = "auto";

interface CopyMessageDialogProps {
  clusterId: string;
  topic: string;
  /** One message (from its detail panel) or a selection from the table. */
  messages: MessageRef[];
  targets: CopyTarget[];
  onCopied?: () => void;
}

/** Duplicates messages (same topic) or copies them elsewhere. The originals are never touched. */
export function CopyMessageDialog({ clusterId, topic, messages, targets, onCopied }: CopyMessageDialogProps) {
  const [open, setOpen] = useState(false);
  const [targetTopic, setTargetTopic] = useState(topic);
  const [partition, setPartition] = useState(AUTO_PARTITION);
  const copy = useCopyMessages(clusterId);
  const single = messages.length === 1 ? messages[0] : null;

  // Fall back to the current topic until the topic list loads.
  const options = targets.some((t) => t.name === topic) ? targets : [{ name: topic, partitions: 0 }, ...targets];
  const targetPartitions = options.find((t) => t.name === targetTopic)?.partitions ?? 0;

  function changeTarget(name: string) {
    setTargetTopic(name);
    setPartition(AUTO_PARTITION); // partition numbers differ per topic
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    copy.mutate(
      {
        topic,
        // Oldest first within each partition, so copies keep their relative order.
        messages: [...messages].sort((a, b) => a.partition - b.partition || a.offset - b.offset),
        targetTopic,
        targetPartition: partition === AUTO_PARTITION ? null : Number(partition),
      },
      {
        onSuccess: (delivered) => {
          const [d] = delivered;
          toast.success(
            delivered.length === 1
              ? `Copied to ${targetTopic} · partition ${d.partition}, offset ${d.offset}`
              : `Copied ${delivered.length} messages to ${targetTopic}`,
          );
          setOpen(false);
          onCopied?.();
        },
      },
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) copy.reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <ForwardIcon /> {single ? "Copy to topic" : `Copy ${messages.length} to topic`}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{single ? "Copy message to topic" : `Copy ${messages.length} messages to topic`}</DialogTitle>
          <DialogDescription className="font-mono [overflow-wrap:anywhere]">
            {single ? `${topic} · partition ${single.partition} · offset ${single.offset}` : `from ${topic}`}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
          <FieldGroup>
            {/* minmax(0, …): grid columns otherwise refuse to shrink below their
                content, so a long topic name would push the dialog off screen. */}
            <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-4">
              <Field className="min-w-0">
                <FieldLabel htmlFor="copy-target-topic">Target topic</FieldLabel>
                <TopicPicker
                  id="copy-target-topic"
                  value={targetTopic}
                  options={options}
                  currentTopic={topic}
                  onChange={changeTarget}
                />
              </Field>
              <Field className="min-w-0">
                <FieldLabel>Partition</FieldLabel>
                <Select value={partition} onValueChange={setPartition}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={AUTO_PARTITION}>Auto (by key)</SelectItem>
                    {Array.from({ length: targetPartitions }, (_, p) => (
                      <SelectItem key={p} value={String(p)}>
                        Partition {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            {copy.error && <FieldError>{copy.error.message}</FieldError>}
          </FieldGroup>
          <DialogFooter>
            <Button type="submit" disabled={copy.isPending}>
              {copy.isPending ? <Spinner /> : <ForwardIcon />}
              {targetTopic === topic ? "Duplicate" : "Copy"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

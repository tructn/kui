import { CopyIcon, MoveRightIcon } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";

import { useCopyMessage } from "../queries";
import type { CopyTarget, KafkaMessage } from "../types";
import { TopicPicker } from "./topic-picker";

const AUTO_PARTITION = "auto";

interface CopyMessageDialogProps {
  clusterId: string;
  topic: string;
  message: KafkaMessage;
  targets: CopyTarget[];
  /** Called after a successful move, since the original no longer exists. */
  onMoved: () => void;
}

/** Duplicates a message (same topic), copies it elsewhere, or moves it. */
export function CopyMessageDialog({ clusterId, topic, message, targets, onMoved }: CopyMessageDialogProps) {
  const [open, setOpen] = useState(false);
  const [targetTopic, setTargetTopic] = useState(topic);
  const [partition, setPartition] = useState(AUTO_PARTITION);
  const [keepTimestamp, setKeepTimestamp] = useState(false);
  const [move, setMove] = useState(false);
  const copy = useCopyMessage(clusterId);

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
        partition: message.partition,
        offset: message.offset,
        targetTopic,
        targetPartition: partition === AUTO_PARTITION ? null : Number(partition),
        keepTimestamp,
        deleteSource: move,
      },
      {
        onSuccess: (d) => {
          toast.success(`${move ? "Moved" : "Copied"} to ${targetTopic} · partition ${d.partition}, offset ${d.offset}`);
          setOpen(false);
          if (move) onMoved();
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
          <CopyIcon /> Copy / Move
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Copy or move message</DialogTitle>
          <DialogDescription className="font-mono [overflow-wrap:anywhere]">
            {topic} · partition {message.partition} · offset {message.offset}
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
            <Field orientation="horizontal">
              <Switch id="copy-keep-ts" checked={keepTimestamp} onCheckedChange={setKeepTimestamp} />
              <Label htmlFor="copy-keep-ts">Keep original timestamp</Label>
            </Field>
            <Field>
              <div className="flex items-center gap-3">
                <Switch id="copy-move" checked={move} onCheckedChange={setMove} />
                <Label htmlFor="copy-move">Delete the original (move)</Label>
              </div>
              <FieldDescription>
                Kafka can only delete the start of a partition, so only the oldest message in its partition can be
                moved.
              </FieldDescription>
            </Field>
            {copy.error && <FieldError>{copy.error.message}</FieldError>}
          </FieldGroup>
          <DialogFooter>
            <Button type="submit" variant={move ? "destructive" : "default"} disabled={copy.isPending}>
              {copy.isPending ? <Spinner /> : move ? <MoveRightIcon /> : <CopyIcon />}
              {move ? "Move" : targetTopic === topic ? "Duplicate" : "Copy"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

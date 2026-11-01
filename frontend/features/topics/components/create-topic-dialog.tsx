import { PlusIcon } from "lucide-react";
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
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { parseKeyValueLines } from "@/lib/key-value";

import { useCreateTopic } from "../queries";

interface CreateTopicDialogProps {
  clusterId: string;
  /** Called with the new topic name after it is created. */
  onCreated: (topic: string) => void;
}

export function CreateTopicDialog({ clusterId, onCreated }: CreateTopicDialogProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [partitions, setPartitions] = useState("3");
  const [replication, setReplication] = useState("1");
  const [configs, setConfigs] = useState("");
  const create = useCreateTopic(clusterId);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const request = {
      name: name.trim(),
      partitions: Number(partitions),
      replicationFactor: Number(replication),
      configs: Object.fromEntries(parseKeyValueLines(configs)),
    };
    create.mutate(request, {
      onSuccess: () => {
        toast.success(`Created ${request.name}`);
        setOpen(false);
        onCreated(request.name);
      },
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <PlusIcon /> New topic
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create topic</DialogTitle>
          <DialogDescription>Partitions can be increased later, but never decreased.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="topic-name">Name</FieldLabel>
              <Input
                id="topic-name"
                required
                autoFocus
                pattern="[a-zA-Z0-9._\-]+"
                className="font-mono"
                placeholder="orders.created"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field>
                <FieldLabel htmlFor="topic-partitions">Partitions</FieldLabel>
                <Input
                  id="topic-partitions"
                  type="number"
                  min={1}
                  required
                  value={partitions}
                  onChange={(e) => setPartitions(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="topic-replication">Replication factor</FieldLabel>
                <Input
                  id="topic-replication"
                  type="number"
                  min={1}
                  required
                  value={replication}
                  onChange={(e) => setReplication(e.target.value)}
                />
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="topic-configs">Configuration</FieldLabel>
              <Textarea
                id="topic-configs"
                className="min-h-20 font-mono text-xs"
                placeholder={"cleanup.policy=compact\nretention.ms=604800000"}
                value={configs}
                onChange={(e) => setConfigs(e.target.value)}
              />
              <FieldDescription>Optional overrides, one key=value per line.</FieldDescription>
            </Field>
            {create.error && <FieldError>{create.error.message}</FieldError>}
          </FieldGroup>
          <DialogFooter>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending && <Spinner />} Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

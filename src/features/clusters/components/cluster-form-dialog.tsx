import { CheckCircle2Icon, PlugZapIcon } from "lucide-react";
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
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { formatKeyValueLines, parseKeyValueLines } from "@/lib/key-value";

import { useSaveCluster, useTestConnection } from "../queries";
import {
  emptyCluster,
  SASL_MECHANISMS,
  SECURITY_PROTOCOLS,
  type ClusterConfig,
  type SecurityProtocol,
} from "../types";

interface ClusterFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Cluster to edit; omit to create a new one. */
  cluster?: ClusterConfig;
  onSaved?: (cluster: ClusterConfig) => void;
}

export function ClusterFormDialog({ open, onOpenChange, cluster, onSaved }: ClusterFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{cluster ? "Edit cluster" : "Add cluster"}</DialogTitle>
          <DialogDescription>Connection settings are stored locally on this machine.</DialogDescription>
        </DialogHeader>
        {/* Mounting the form only while open resets its state each time. */}
        {open && (
          <ClusterForm
            initial={cluster ?? emptyCluster()}
            onSaved={(saved) => {
              onOpenChange(false);
              onSaved?.(saved);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ClusterForm({ initial, onSaved }: { initial: ClusterConfig; onSaved: (c: ClusterConfig) => void }) {
  const [form, setForm] = useState(initial);
  const [propertiesText, setPropertiesText] = useState(() => formatKeyValueLines(initial.properties));
  const save = useSaveCluster();
  const test = useTestConnection();

  const usesSasl = form.securityProtocol.startsWith("SASL");
  const update = (patch: Partial<ClusterConfig>) => {
    setForm((f) => ({ ...f, ...patch }));
    test.reset();
  };
  const toConfig = (): ClusterConfig => ({ ...form, properties: Object.fromEntries(parseKeyValueLines(propertiesText)) });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    save.mutate(toConfig(), {
      onSuccess: (saved) => {
        toast.success(`Saved ${saved.name}`);
        onSaved(saved);
      },
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="cluster-name">Name</FieldLabel>
          <Input
            id="cluster-name"
            required
            autoFocus
            placeholder="Local"
            value={form.name}
            onChange={(e) => update({ name: e.target.value })}
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="cluster-bootstrap">Bootstrap servers</FieldLabel>
          <Input
            id="cluster-bootstrap"
            required
            className="font-mono"
            placeholder="broker1:9092,broker2:9092"
            value={form.bootstrapServers}
            onChange={(e) => update({ bootstrapServers: e.target.value })}
          />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field>
            <FieldLabel>Security protocol</FieldLabel>
            <Select
              value={form.securityProtocol}
              onValueChange={(v) => update({ securityProtocol: v as SecurityProtocol })}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SECURITY_PROTOCOLS.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {usesSasl && (
            <Field>
              <FieldLabel>SASL mechanism</FieldLabel>
              <Select value={form.saslMechanism ?? "PLAIN"} onValueChange={(v) => update({ saslMechanism: v })}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SASL_MECHANISMS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
        </div>

        {usesSasl && (
          <div className="grid grid-cols-2 gap-4">
            <Field>
              <FieldLabel htmlFor="cluster-username">Username</FieldLabel>
              <Input
                id="cluster-username"
                autoComplete="off"
                value={form.saslUsername ?? ""}
                onChange={(e) => update({ saslUsername: e.target.value })}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="cluster-password">Password</FieldLabel>
              <Input
                id="cluster-password"
                type="password"
                autoComplete="off"
                value={form.saslPassword ?? ""}
                onChange={(e) => update({ saslPassword: e.target.value })}
              />
            </Field>
          </div>
        )}

        <Field>
          <FieldLabel htmlFor="cluster-registry">Schema Registry URL</FieldLabel>
          <Input
            id="cluster-registry"
            className="font-mono"
            placeholder="http://localhost:8081"
            value={form.schemaRegistryUrl ?? ""}
            onChange={(e) => update({ schemaRegistryUrl: e.target.value || null })}
          />
          <FieldDescription>Optional. Needed to decode Avro and Protobuf messages.</FieldDescription>
        </Field>

        {form.schemaRegistryUrl && (
          <div className="grid grid-cols-2 gap-4">
            <Field>
              <FieldLabel htmlFor="cluster-registry-username">Registry username</FieldLabel>
              <Input
                id="cluster-registry-username"
                autoComplete="off"
                placeholder="Optional"
                value={form.schemaRegistryUsername ?? ""}
                onChange={(e) => update({ schemaRegistryUsername: e.target.value || null })}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="cluster-registry-password">Registry password</FieldLabel>
              <Input
                id="cluster-registry-password"
                type="password"
                autoComplete="off"
                value={form.schemaRegistryPassword ?? ""}
                onChange={(e) => update({ schemaRegistryPassword: e.target.value || null })}
              />
            </Field>
          </div>
        )}

        <Field>
          <FieldLabel htmlFor="cluster-properties">Advanced properties</FieldLabel>
          <Textarea
            id="cluster-properties"
            className="min-h-20 font-mono text-xs"
            placeholder={"ssl.ca.location=/path/to/ca.pem\nssl.endpoint.identification.algorithm=none"}
            value={propertiesText}
            onChange={(e) => {
              setPropertiesText(e.target.value);
              test.reset();
            }}
          />
          <FieldDescription>librdkafka settings, one key=value per line.</FieldDescription>
        </Field>

        {save.error && <FieldError>{save.error.message}</FieldError>}
        {test.error && <FieldError>{test.error.message}</FieldError>}
      </FieldGroup>

      <DialogFooter className="sm:justify-between">
        <Button type="button" variant="outline" disabled={test.isPending} onClick={() => test.mutate(toConfig())}>
          {test.isPending ? <Spinner /> : test.isSuccess ? <CheckCircle2Icon className="text-emerald-500" /> : <PlugZapIcon />}
          {test.isSuccess ? `Connected · ${test.data} broker${test.data === 1 ? "" : "s"}` : "Test connection"}
        </Button>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending && <Spinner />}
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}

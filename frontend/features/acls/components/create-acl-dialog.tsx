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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";

import { useCreateAcl } from "../queries";
import { label, OPERATIONS, PATTERN_TYPES, PERMISSIONS, RESOURCE_TYPES, type Acl } from "../types";

const BLANK: Acl = {
  principal: "User:",
  host: "*",
  resourceType: "Topic",
  resourceName: "",
  patternType: "Literal",
  operation: "Read",
  permission: "Allow",
};

/** The cluster resource has one fixed name; Kafka rejects any other. */
const CLUSTER_NAME = "kafka-cluster";

export function CreateAclDialog({ clusterId }: { clusterId: string }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Acl>(BLANK);
  const create = useCreateAcl(clusterId);
  const isCluster = form.resourceType === "Cluster";

  function update(change: Partial<Acl>) {
    setForm((f) => ({ ...f, ...change }));
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setForm(BLANK);
      create.reset();
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const acl = isCluster ? { ...form, resourceName: CLUSTER_NAME, patternType: "Literal" as const } : form;
    create.mutate(acl, {
      onSuccess: () => {
        toast.success(`Added ACL for ${acl.principal.trim()}`);
        setOpen(false);
      },
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm">
          <PlusIcon /> New ACL
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create ACL</DialogTitle>
          <DialogDescription>A Deny ACL wins over any Allow ACL that matches the same request.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
          <FieldGroup>
            <div className="grid grid-cols-[2fr_1fr] gap-4">
              <Field>
                <FieldLabel htmlFor="acl-principal">Principal</FieldLabel>
                <Input
                  id="acl-principal"
                  required
                  autoFocus
                  pattern="\s*[^:\s]+:\S+\s*"
                  title="Type:name, for example User:alice or User:*"
                  className="font-mono"
                  placeholder="User:alice"
                  value={form.principal}
                  onChange={(e) => update({ principal: e.target.value })}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="acl-host">Host</FieldLabel>
                <Input
                  id="acl-host"
                  className="font-mono"
                  placeholder="*"
                  value={form.host}
                  onChange={(e) => update({ host: e.target.value })}
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field>
                <FieldLabel htmlFor="acl-permission">Permission</FieldLabel>
                <EnumSelect
                  id="acl-permission"
                  value={form.permission}
                  values={PERMISSIONS}
                  onChange={(permission) => update({ permission })}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="acl-operation">Operation</FieldLabel>
                <EnumSelect
                  id="acl-operation"
                  value={form.operation}
                  values={OPERATIONS}
                  onChange={(operation) => update({ operation })}
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field>
                <FieldLabel htmlFor="acl-resource-type">Resource type</FieldLabel>
                <EnumSelect
                  id="acl-resource-type"
                  value={form.resourceType}
                  values={RESOURCE_TYPES}
                  onChange={(resourceType) => update({ resourceType })}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="acl-pattern">Pattern</FieldLabel>
                <EnumSelect
                  id="acl-pattern"
                  value={isCluster ? "Literal" : form.patternType}
                  values={PATTERN_TYPES}
                  disabled={isCluster}
                  onChange={(patternType) => update({ patternType })}
                />
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="acl-resource-name">Resource name</FieldLabel>
              <Input
                id="acl-resource-name"
                required
                disabled={isCluster}
                className="font-mono"
                placeholder={form.patternType === "Prefixed" ? "orders." : "orders"}
                value={isCluster ? CLUSTER_NAME : form.resourceName}
                onChange={(e) => update({ resourceName: e.target.value })}
              />
              <FieldDescription>
                {isCluster
                  ? "Cluster ACLs always apply to the whole cluster."
                  : form.patternType === "Prefixed"
                    ? "Matches every name that starts with this text."
                    : "Matches this exact name. Use * for all of them."}
              </FieldDescription>
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

interface EnumSelectProps<T extends string> {
  id: string;
  value: T;
  values: readonly T[];
  disabled?: boolean;
  onChange: (value: T) => void;
}

function EnumSelect<T extends string>({ id, value, values, disabled, onChange }: EnumSelectProps<T>) {
  return (
    <Select value={value} disabled={disabled} onValueChange={(v) => onChange(v as T)}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {values.map((v) => (
          <SelectItem key={v} value={v}>
            {label(v)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

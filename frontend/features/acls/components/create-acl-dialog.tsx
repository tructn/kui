import { PlusIcon } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";

import { aclsFromForm, OPERATION_LABELS, RESOURCE_LABELS } from "../acl";
import { useCreateAcls } from "../queries";
import { CLUSTER_RESOURCE_NAME, OPERATIONS, type Operation, type PatternType, type Permission, type ResourceType } from "../types";

const RESOURCE_TYPES = Object.keys(RESOURCE_LABELS) as ResourceType[];

export function CreateAclDialog({ clusterId }: { clusterId: string }) {
  const [open, setOpen] = useState(false);
  const [principal, setPrincipal] = useState("User:");
  const [host, setHost] = useState("*");
  const [resourceType, setResourceType] = useState<ResourceType>("topic");
  const [patternType, setPatternType] = useState<PatternType>("literal");
  const [resourceName, setResourceName] = useState("");
  const [permission, setPermission] = useState<Permission>("allow");
  const [chosen, setChosen] = useState<readonly Operation[]>([]);
  const create = useCreateAcls(clusterId);

  const cluster = resourceType === "cluster";
  // Choices that don't apply to the current resource type are kept, so switching back restores them.
  const operations = OPERATIONS[resourceType].filter((o) => chosen.includes(o));
  const acls = aclsFromForm({ principal, host, resourceType, patternType, resourceName, permission, operations });

  function toggle(operation: Operation, on: boolean) {
    setChosen((current) => (on ? [...current, operation] : current.filter((o) => o !== operation)));
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) create.reset();
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    create.mutate(acls, {
      onSuccess: () => {
        toast.success(acls.length === 1 ? "Created ACL" : `Created ${acls.length} ACLs`);
        setOpen(false);
        setChosen([]);
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
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create ACL</DialogTitle>
          <DialogDescription>One ACL is created for each operation you choose.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
          <FieldGroup>
            <div className="grid grid-cols-[1fr_8rem] gap-4">
              <Field>
                <FieldLabel htmlFor="acl-principal">Principal</FieldLabel>
                <Input
                  id="acl-principal"
                  required
                  autoFocus
                  pattern="[^:\s]+:\S+"
                  className="font-mono"
                  placeholder="User:alice"
                  value={principal}
                  onChange={(e) => setPrincipal(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="acl-host">Host</FieldLabel>
                <Input
                  id="acl-host"
                  className="font-mono"
                  placeholder="*"
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field>
                <FieldLabel htmlFor="acl-resource-type">Resource type</FieldLabel>
                <Select value={resourceType} onValueChange={(v) => setResourceType(v as ResourceType)}>
                  <SelectTrigger id="acl-resource-type" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RESOURCE_TYPES.map((r) => (
                      <SelectItem key={r} value={r}>
                        {RESOURCE_LABELS[r]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="acl-permission">Permission</FieldLabel>
                <Select value={permission} onValueChange={(v) => setPermission(v as Permission)}>
                  <SelectTrigger id="acl-permission" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="allow">Allow</SelectItem>
                    <SelectItem value="deny">Deny</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <div className="grid grid-cols-[1fr_8rem] gap-4">
              <Field>
                <FieldLabel htmlFor="acl-resource-name">Resource name</FieldLabel>
                <Input
                  id="acl-resource-name"
                  required
                  disabled={cluster}
                  className="font-mono"
                  placeholder="orders, or * for all"
                  value={cluster ? CLUSTER_RESOURCE_NAME : resourceName}
                  onChange={(e) => setResourceName(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="acl-pattern">Match</FieldLabel>
                <Select
                  value={cluster ? "literal" : patternType}
                  disabled={cluster}
                  onValueChange={(v) => setPatternType(v as PatternType)}
                >
                  <SelectTrigger id="acl-pattern" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="literal">Exact name</SelectItem>
                    <SelectItem value="prefixed">Prefix</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <FieldSet>
              <FieldLegend variant="label">Operations</FieldLegend>
              <FieldDescription>All covers every operation on the resource.</FieldDescription>
              <div className="grid grid-cols-2 gap-2">
                {OPERATIONS[resourceType].map((o) => (
                  <Field key={o} orientation="horizontal">
                    <Checkbox
                      id={`acl-op-${o}`}
                      checked={operations.includes(o)}
                      onCheckedChange={(on) => toggle(o, on === true)}
                    />
                    <FieldLabel htmlFor={`acl-op-${o}`} className="font-normal">
                      {OPERATION_LABELS[o]}
                    </FieldLabel>
                  </Field>
                ))}
              </div>
            </FieldSet>
            {create.error && <FieldError>{create.error.message}</FieldError>}
          </FieldGroup>
          <DialogFooter>
            <Button type="submit" disabled={create.isPending || acls.length === 0}>
              {create.isPending && <Spinner />} {acls.length > 1 ? `Create ${acls.length} ACLs` : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

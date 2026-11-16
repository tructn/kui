import { CLUSTER_RESOURCE_NAME, type AclBinding, type Operation, type PatternType, type Permission, type ResourceType } from "./types";

export const RESOURCE_LABELS: Record<ResourceType, string> = {
  topic: "Topic",
  group: "Group",
  cluster: "Cluster",
  transactionalId: "Transactional ID",
};

export const OPERATION_LABELS: Record<Operation, string> = {
  all: "All",
  read: "Read",
  write: "Write",
  create: "Create",
  delete: "Delete",
  alter: "Alter",
  describe: "Describe",
  clusterAction: "Cluster action",
  describeConfigs: "Describe configs",
  alterConfigs: "Alter configs",
  idempotentWrite: "Idempotent write",
};

/** A stable identity for an ACL: every field, since two ACLs may differ in only one. */
export function aclKey(acl: AclBinding): string {
  return JSON.stringify([
    acl.resourceType,
    acl.patternType,
    acl.resourceName,
    acl.principal,
    acl.host,
    acl.operation,
    acl.permission,
  ]);
}

/** A one-line description, e.g. "Allow User:alice to Read topic orders* from any host". */
export function describeAcl(acl: AclBinding): string {
  const name = acl.patternType === "prefixed" ? `${acl.resourceName}*` : acl.resourceName;
  const verb = acl.permission === "allow" ? "Allow" : "Deny";
  const host = acl.host === "*" ? "any host" : acl.host;
  return `${verb} ${acl.principal} to ${OPERATION_LABELS[acl.operation]} ${RESOURCE_LABELS[acl.resourceType].toLowerCase()} ${name} from ${host}`;
}

/** Whether the ACL's principal, resource name or host contains `query`, ignoring case. */
export function matchesAcl(acl: AclBinding, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [acl.principal, acl.resourceName, acl.host].some((field) => field.toLowerCase().includes(q));
}

export interface AclForm {
  principal: string;
  host: string;
  resourceType: ResourceType;
  patternType: PatternType;
  resourceName: string;
  permission: Permission;
  operations: readonly Operation[];
}

/**
 * The ACLs a create form asks for: one per chosen operation, which is how
 * Kafka stores them. A cluster resource always has the fixed literal name.
 */
export function aclsFromForm(form: AclForm): AclBinding[] {
  const cluster = form.resourceType === "cluster";
  return form.operations.map((operation) => ({
    resourceType: form.resourceType,
    resourceName: cluster ? CLUSTER_RESOURCE_NAME : form.resourceName.trim(),
    patternType: cluster ? "literal" : form.patternType,
    principal: form.principal.trim(),
    host: form.host.trim() || "*",
    operation,
    permission: form.permission,
  }));
}

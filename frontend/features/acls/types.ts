// Mirrors `crates/kui_kafka/src/acls.rs`. "Unknown" is a value from a newer
// broker that KUI can show but not create.

export const RESOURCE_TYPES = ["Topic", "Group", "Cluster", "TransactionalId"] as const;
export const PATTERN_TYPES = ["Literal", "Prefixed"] as const;
export const OPERATIONS = [
  "All",
  "Read",
  "Write",
  "Create",
  "Delete",
  "Alter",
  "Describe",
  "ClusterAction",
  "DescribeConfigs",
  "AlterConfigs",
  "IdempotentWrite",
] as const;
export const PERMISSIONS = ["Allow", "Deny"] as const;

export type ResourceType = (typeof RESOURCE_TYPES)[number] | "Unknown";
export type PatternType = (typeof PATTERN_TYPES)[number] | "Unknown";
export type Operation = (typeof OPERATIONS)[number] | "Unknown";
export type Permission = (typeof PERMISSIONS)[number] | "Unknown";

export interface Acl {
  /** e.g. `User:alice`. */
  principal: string;
  /** Client IP address, or `*` for any host. */
  host: string;
  resourceType: ResourceType;
  resourceName: string;
  patternType: PatternType;
  operation: Operation;
  permission: Permission;
}

/** Display names for the enum values, e.g. `TransactionalId` -> "Transactional ID". */
export const LABELS: Record<string, string> = {
  TransactionalId: "Transactional ID",
  ClusterAction: "Cluster action",
  DescribeConfigs: "Describe configs",
  AlterConfigs: "Alter configs",
  IdempotentWrite: "Idempotent write",
};

export function label(value: string): string {
  return LABELS[value] ?? value;
}

/** A stable identity for a row: every field together. */
export function aclKey(acl: Acl): string {
  return [acl.principal, acl.host, acl.resourceType, acl.resourceName, acl.patternType, acl.operation, acl.permission].join("\u0000");
}

/** What the backend says when the cluster has no authorizer (see `crates/kui_kafka/src/admin.rs`). */
export function isAclsDisabled(error: Error | null): boolean {
  return error?.message.startsWith("ACLs are turned off") ?? false;
}

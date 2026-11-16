// Mirrors `crates/kui_kafka/src/acls.rs`.

export type ResourceType = "topic" | "group" | "cluster" | "transactionalId";

/** literal: exactly this name, or every resource when it is `*`. prefixed: every name starting with it. */
export type PatternType = "literal" | "prefixed";

export type Operation =
  | "all"
  | "read"
  | "write"
  | "create"
  | "delete"
  | "alter"
  | "describe"
  | "clusterAction"
  | "describeConfigs"
  | "alterConfigs"
  | "idempotentWrite";

export type Permission = "allow" | "deny";

export interface AclBinding {
  resourceType: ResourceType;
  resourceName: string;
  patternType: PatternType;
  /** e.g. `User:alice`, or `User:*` for everyone. */
  principal: string;
  /** An IP address, or `*` for any host. */
  host: string;
  operation: Operation;
  permission: Permission;
}

/** The name a cluster resource always has. */
export const CLUSTER_RESOURCE_NAME = "kafka-cluster";

/** The operations Kafka checks on each kind of resource; mirrors `ResourceType::operations`. */
export const OPERATIONS: Record<ResourceType, readonly Operation[]> = {
  topic: ["all", "read", "write", "create", "delete", "alter", "describe", "describeConfigs", "alterConfigs"],
  group: ["all", "read", "delete", "describe"],
  cluster: ["all", "create", "alter", "describe", "clusterAction", "describeConfigs", "alterConfigs", "idempotentWrite"],
  transactionalId: ["all", "write", "describe"],
};

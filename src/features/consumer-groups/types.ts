// Mirrors `src-tauri/src/features/consumer_groups/model.rs`.

export interface GroupSummary {
  name: string;
  /** e.g. Stable, Empty, PreparingRebalance, Assigning, Dead */
  state: string;
  /** Rebalance protocol: Classic, or Consumer for KIP-848 groups. */
  groupType: string;
  /** Partition assignor, e.g. range or uniform. */
  protocol: string;
  members: number;
}

/** Loaded separately from the list: needs one offset request per group. */
export interface GroupLag {
  name: string;
  /** Topics the group has committed to or is assigned. */
  topics: string[];
  /** null when the group's offsets could not be read. */
  lag: number | null;
}

export interface GroupMember {
  id: string;
  clientId: string;
  host: string;
  /** topic -> partitions */
  assignment: Record<string, number[]>;
}

/**
 * - notStarted: nothing committed, the group never consumed this partition
 * - behind: messages are waiting after the committed offset
 * - caughtUp: committed offset is at the end
 * - outOfRange: retention deleted messages before the group read them
 */
export type PartitionStatus = "notStarted" | "behind" | "caughtUp" | "outOfRange";

export interface PartitionOffset {
  topic: string;
  partition: number;
  /** First offset still on the broker. */
  low: number;
  /** Next offset to be written. */
  high: number;
  /** Next offset the group will read; null if it never committed here. */
  committed: number | null;
  lag: number | null;
  status: PartitionStatus;
  /** Client id of the member assigned this partition. */
  owner: string | null;
}

/** One topic from a group's point of view. consumed + lag + untouched = messages on the broker. */
export interface TopicProgress {
  topic: string;
  partitions: number;
  caughtUp: number;
  behind: number;
  notStarted: number;
  outOfRange: number;
  consumed: number;
  lag: number;
  untouched: number;
}

export interface GroupDetail {
  name: string;
  state: string;
  members: GroupMember[];
  topics: TopicProgress[];
  /** Every partition of every topic in `topics`. */
  offsets: PartitionOffset[];
  totalLag: number;
}

/** How far one group has read a given topic. */
export interface TopicConsumer {
  group: string;
  state: string;
  members: number;
  progress: TopicProgress;
  offsets: PartitionOffset[];
}

/** Where to move a group's committed offsets. */
export type ResetTo =
  /** First message still on the broker: replay everything retained. */
  | { kind: "earliest" }
  /** The end: skip everything not yet read. */
  | { kind: "latest" }
  /** First message at or after an epoch-millis time. */
  | { kind: "timestamp"; value: number }
  /** A given offset, kept within what the broker still has. */
  | { kind: "offset"; value: number };

export interface ResetRequest {
  group: string;
  topic: string;
  /** null = every partition of the topic */
  partitions: number[] | null;
  to: ResetTo;
}

/** One partition's committed offset before and after a reset. */
export interface OffsetChange {
  partition: number;
  low: number;
  high: number;
  /** null when the group never committed here. */
  current: number | null;
  target: number;
}

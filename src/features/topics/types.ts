// Mirrors `src-tauri/src/features/topics/model.rs`.

export interface TopicSummary {
  name: string;
  partitions: number;
  replicationFactor: number;
  internal: boolean;
  messageCount: number;
  underReplicatedPartitions: number;
}

export interface Partition {
  id: number;
  leader: number;
  replicas: number[];
  isr: number[];
  low: number;
  high: number;
}

export interface TopicConfigEntry {
  name: string;
  value: string | null;
  source: string;
  isDefault: boolean;
  isReadOnly: boolean;
  isSensitive: boolean;
}

export interface TopicDetail {
  name: string;
  /** Kafka's or a platform tool's topic (name starts with `_`); shown read-only. */
  internal: boolean;
  partitions: Partition[];
  configs: TopicConfigEntry[];
}

export interface NewTopicRequest {
  name: string;
  partitions: number;
  replicationFactor: number;
  configs: Record<string, string>;
}

/** Outcome of deleting one topic in a batch; Kafka deletes each topic independently. */
export interface DeleteTopicResult {
  topic: string;
  /** null when the topic was deleted. */
  error: string | null;
}

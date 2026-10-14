// Mirrors `src-tauri/src/features/brokers/model.rs`.

export interface Broker {
  id: number;
  host: string;
  port: number;
  leaderPartitions: number;
  replicaPartitions: number;
}

export interface ClusterOverview {
  brokers: Broker[];
  topicCount: number;
  partitionCount: number;
  underReplicatedPartitions: number;
  offlinePartitions: number;
}

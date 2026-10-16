// Mirrors `src-tauri/src/kafka/cluster.rs`.

export const SECURITY_PROTOCOLS = ["PLAINTEXT", "SSL", "SASL_PLAINTEXT", "SASL_SSL"] as const;
export const SASL_MECHANISMS = ["PLAIN", "SCRAM-SHA-256", "SCRAM-SHA-512"] as const;

export type SecurityProtocol = (typeof SECURITY_PROTOCOLS)[number];

export interface ClusterConfig {
  /** Empty string for a cluster that hasn't been saved yet. */
  id: string;
  name: string;
  bootstrapServers: string;
  securityProtocol: SecurityProtocol;
  saslMechanism: string | null;
  saslUsername: string | null;
  saslPassword: string | null;
  /** Extra librdkafka properties. */
  properties: Record<string, string>;
  /** Confluent-compatible Schema Registry; needed to decode Avro and registry-framed Protobuf. */
  schemaRegistryUrl: string | null;
  schemaRegistryUsername: string | null;
  schemaRegistryPassword: string | null;
}

export function emptyCluster(): ClusterConfig {
  return {
    id: "",
    name: "",
    bootstrapServers: "localhost:9092",
    securityProtocol: "PLAINTEXT",
    saslMechanism: "PLAIN",
    saslUsername: null,
    saslPassword: null,
    properties: {},
    schemaRegistryUrl: null,
    schemaRegistryUsername: null,
    schemaRegistryPassword: null,
  };
}

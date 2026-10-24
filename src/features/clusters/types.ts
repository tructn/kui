// Mirrors `src-tauri/src/kafka/cluster.rs`.

export const SECURITY_PROTOCOLS = ["PLAINTEXT", "SSL", "SASL_PLAINTEXT", "SASL_SSL"] as const;
export const SASL_MECHANISMS = ["PLAIN", "SCRAM-SHA-256", "SCRAM-SHA-512", "OAUTHBEARER"] as const;

export type SecurityProtocol = (typeof SECURITY_PROTOCOLS)[number];
export type SaslMechanism = (typeof SASL_MECHANISMS)[number];

export interface ClusterConfig {
  /** Empty string for a cluster that hasn't been saved yet. */
  id: string;
  name: string;
  bootstrapServers: string;
  securityProtocol: SecurityProtocol;

  saslMechanism: SaslMechanism | null;
  /** PLAIN and SCRAM. */
  saslUsername: string | null;
  saslPassword: string | null;

  /** OAUTHBEARER: OAuth 2.0 client-credentials grant. */
  oauthTokenEndpoint: string | null;
  oauthClientId: string | null;
  oauthClientSecret: string | null;
  oauthScope: string | null;

  /** SSL and SASL_SSL: PEM file paths. */
  sslCaLocation: string | null;
  sslCertificateLocation: string | null;
  sslKeyLocation: string | null;
  sslKeyPassword: string | null;
  sslVerifyHostname: boolean;

  /** Extra librdkafka properties. */
  properties: Record<string, string>;
}

export const usesTls = (protocol: SecurityProtocol) => protocol === "SSL" || protocol === "SASL_SSL";
export const usesSasl = (protocol: SecurityProtocol) => protocol.startsWith("SASL");

export function emptyCluster(): ClusterConfig {
  return {
    id: "",
    name: "",
    bootstrapServers: "localhost:9092",
    securityProtocol: "PLAINTEXT",
    saslMechanism: "PLAIN",
    saslUsername: null,
    saslPassword: null,
    oauthTokenEndpoint: null,
    oauthClientId: null,
    oauthClientSecret: null,
    oauthScope: null,
    sslCaLocation: null,
    sslCertificateLocation: null,
    sslKeyLocation: null,
    sslKeyPassword: null,
    sslVerifyHostname: true,
    properties: {},
  };
}

/**
 * Drops the settings the chosen protocol and mechanism don't use, so a
 * password typed before switching to OAuth isn't kept on disk.
 */
export function withoutUnusedSecurity(cluster: ClusterConfig): ClusterConfig {
  const tls = usesTls(cluster.securityProtocol);
  const sasl = usesSasl(cluster.securityProtocol);
  const oauth = sasl && cluster.saslMechanism === "OAUTHBEARER";
  const password = sasl && !oauth;
  const keep = <T>(on: boolean, value: T) => (on ? value : null);
  return {
    ...cluster,
    saslMechanism: keep(sasl, cluster.saslMechanism),
    saslUsername: keep(password, cluster.saslUsername),
    saslPassword: keep(password, cluster.saslPassword),
    oauthTokenEndpoint: keep(oauth, cluster.oauthTokenEndpoint),
    oauthClientId: keep(oauth, cluster.oauthClientId),
    oauthClientSecret: keep(oauth, cluster.oauthClientSecret),
    oauthScope: keep(oauth, cluster.oauthScope),
    sslCaLocation: keep(tls, cluster.sslCaLocation),
    sslCertificateLocation: keep(tls, cluster.sslCertificateLocation),
    sslKeyLocation: keep(tls, cluster.sslKeyLocation),
    sslKeyPassword: keep(tls, cluster.sslKeyPassword),
  };
}

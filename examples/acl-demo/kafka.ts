import { Kafka, type KafkaConfig, KafkaJSProtocolError, KafkaJSSASLAuthenticationError, logLevel } from "kafkajs";

// The dev broker's SASL listener. Clients on localhost:9092 are ANONYMOUS, a super user that bypasses ACLs.
const BROKER = process.env.KAFKA_SASL_BOOTSTRAP ?? "localhost:9094";

/** The logins in docker-compose.yml. Each password is `<name>-secret`; `nobody` has no ACLs. */
export type DemoUser = "billing-service" | "order-service" | "analytics" | "payments" | "auditor" | "intern" | "nobody";

export function kafkaAs(user: DemoUser, password = `${user}-secret`, config: Partial<KafkaConfig> = {}): Kafka {
  return new Kafka({
    clientId: `acl-demo-${user}`,
    brokers: [BROKER],
    sasl: { mechanism: "plain", username: user, password },
    logLevel: logLevel.WARN,
    ...config,
  });
}

export type Outcome = "allowed" | "denied" | "login failed";

/** What a failed call says about the ACLs, or `undefined` when the error isn't about access. */
export function accessOutcome(error: unknown): Outcome | undefined {
  // KafkaJS wraps the broker's error when a consumer crashes or retries run out.
  for (let e: unknown = error; e instanceof Error; e = e.cause ?? ("originalError" in e ? e.originalError : undefined)) {
    if (e instanceof KafkaJSSASLAuthenticationError) return "login failed";
    // TOPIC_, GROUP_, TRANSACTIONAL_ID_ and CLUSTER_AUTHORIZATION_FAILED
    if (e instanceof KafkaJSProtocolError && e.type.endsWith("_AUTHORIZATION_FAILED")) return "denied";
  }
  return undefined;
}

/** Runs `stop` once on Ctrl-C, so a consumer leaves its group instead of waiting out the session timeout. */
export function stopOnSignal(stop: () => Promise<void>) {
  const handler = () => void stop().finally(() => process.exit(0));
  process.once("SIGINT", handler);
  process.once("SIGTERM", handler);
}

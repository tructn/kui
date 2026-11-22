// Proves the seeded ACLs are enforced: each check logs in as a demo user, tries one thing, and compares what the
// broker did with what the ACLs say. Exits 1 on any mismatch. Never commits offsets, and only writes to
// demo.payments when that's allowed.
import { type Kafka, KafkaJSGroupCoordinatorNotFound, logLevel } from "kafkajs";

import { type DemoUser, type Outcome, accessOutcome, kafkaAs } from "./kafka.ts";

const READ_TIMEOUT_MS = 20_000;

// KafkaJS logs the broker's GROUP_AUTHORIZATION_FAILED at debug level and then throws a generic "Failed to find
// group coordinator" without it, so each check keeps the last access error its client logged.
function checkClient(user: DemoUser, password?: string) {
  let logged: Outcome | undefined;
  const kafka = kafkaAs(user, password, {
    logLevel: logLevel.DEBUG,
    logCreator: () => (entry) => {
      logged = ("error" in entry.log && accessOutcome(entry.log.error)) || logged;
    },
  });
  const outcomeOf = (error: unknown): Outcome | undefined =>
    accessOutcome(error) ?? (error instanceof KafkaJSGroupCoordinatorNotFound ? logged : undefined);
  return { kafka, outcomeOf };
}

async function readOne(kafka: Kafka, topic: string, groupId: string): Promise<Outcome> {
  // KafkaJS would otherwise restart a crashed consumer, retrying the denied join forever.
  const consumer = kafka.consumer({ groupId, retry: { restartOnFailure: async () => false } });
  try {
    await consumer.connect();
    await consumer.subscribe({ topics: [topic], fromBeginning: true });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no message from ${topic} within ${READ_TIMEOUT_MS} ms`)), READ_TIMEOUT_MS);
      // Group and topic denials surface asynchronously, after run() has returned.
      consumer.on(consumer.events.CRASH, ({ payload }) => reject(payload.error));
      void consumer.run({ autoCommit: false, eachMessage: async () => (clearTimeout(timer), resolve()) });
    });
    return "allowed";
  } finally {
    await consumer.disconnect();
  }
}

async function writeOne(kafka: Kafka, topic: string, transactionalId?: string): Promise<Outcome> {
  const producer = kafka.producer(transactionalId ? { transactionalId, idempotent: true, maxInFlightRequests: 1 } : {});
  try {
    await producer.connect();
    const message = { key: "acl-demo", value: JSON.stringify({ check: true, at: new Date().toISOString() }) };
    if (transactionalId) {
      const transaction = await producer.transaction();
      try {
        await transaction.send({ topic, messages: [message] });
        await transaction.commit();
      } catch (error) {
        await transaction.abort().catch(() => {});
        throw error;
      }
    } else {
      await producer.send({ topic, messages: [message] });
    }
    return "allowed";
  } finally {
    await producer.disconnect();
  }
}

// The broker leaves topics a user may not Describe out of the listing instead of returning an error.
async function seesTopic(kafka: Kafka, topic: string): Promise<Outcome> {
  const admin = kafka.admin();
  try {
    await admin.connect();
    return (await admin.listTopics()).includes(topic) ? "allowed" : "denied";
  } finally {
    await admin.disconnect();
  }
}

type Check = { user: DemoUser; password?: string; action: string; expect: Outcome; run: (kafka: Kafka) => Promise<Outcome> };

const read = (topic: string, group: string) => ({ action: `read ${topic} as group ${group}`, run: (k: Kafka) => readOne(k, topic, group) });
const write = (topic: string) => ({ action: `write to ${topic}`, run: (k: Kafka) => writeOne(k, topic) });
const writeInTransaction = (topic: string, id: string) => ({
  action: `write to ${topic} in transaction ${id}`,
  run: (k: Kafka) => writeOne(k, topic, id),
});
const list = (topic: string) => ({ action: `see ${topic} in the topic list`, run: (k: Kafka) => seesTopic(k, topic) });

const sections: [string, Check[]][] = [
  [
    "Literal topic and group ACLs",
    [
      { user: "billing-service", expect: "allowed", ...read("demo.orders", "demo-billing") },
      { user: "billing-service", expect: "denied", ...read("demo.orders", "billing-replay") },
      { user: "billing-service", expect: "denied", ...read("demo.events", "demo-billing") },
      { user: "billing-service", expect: "denied", ...write("demo.orders") },
      // order-service may read demo.customers but has no group ACL, so it can't join any group.
      { user: "order-service", expect: "denied", ...read("demo.customers", "order-service") },
    ],
  ],
  [
    "Prefixed ACLs: topics demo.*, groups analytics-*",
    [
      { user: "analytics", expect: "allowed", ...read("demo.events", "analytics-dashboard") },
      { user: "analytics", expect: "allowed", ...read("demo.catalog", "analytics-dashboard") },
      { user: "analytics", expect: "denied", ...read("demo.events", "reporting") },
    ],
  ],
  [
    "Transactional producer: transactional IDs payments-*",
    [
      { user: "payments", expect: "allowed", ...writeInTransaction("demo.payments", "payments-writer") },
      { user: "payments", expect: "denied", ...writeInTransaction("demo.payments", "refunds-writer") },
      { user: "payments", expect: "denied", ...write("demo.orders") },
    ],
  ],
  [
    "DENY beats ALLOW: the intern may use demo.*, but writes to any topic are denied",
    [
      { user: "intern", expect: "allowed", ...read("demo.customers", "intern-onboarding") },
      { user: "intern", expect: "denied", ...write("demo.payments") },
    ],
  ],
  [
    "Wildcard Describe, and no ACLs at all",
    [
      { user: "auditor", expect: "allowed", ...list("demo.orders") },
      { user: "auditor", expect: "denied", ...write("demo.payments") },
      { user: "nobody", expect: "denied", ...list("demo.orders") },
      { user: "nobody", expect: "denied", ...read("demo.orders", "nobody") },
    ],
  ],
  [
    "Authentication",
    [{ user: "billing-service", password: "wrong-password", expect: "login failed", ...read("demo.orders", "demo-billing") }],
  ],
];

let mismatches = 0;
for (const [title, checks] of sections) {
  console.log(title);
  for (const { user, password, action, expect, run } of checks) {
    const { kafka, outcomeOf } = checkClient(user, password);
    const got = await run(kafka).catch(
      (error: unknown) => outcomeOf(error) ?? `error: ${error instanceof Error ? error.message : String(error)}`,
    );
    const ok = got === expect;
    if (!ok) mismatches++;
    console.log(`  ${ok ? "ok  " : "FAIL"}  ${user.padEnd(16)} ${action.padEnd(56)} ${got}${ok ? "" : `, expected ${expect}`}`);
  }
}
console.log(mismatches ? `${mismatches} check(s) did not match the ACLs.` : "Every check matched the ACLs.");
process.exit(mismatches ? 1 : 0);

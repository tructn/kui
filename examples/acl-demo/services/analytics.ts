// analytics reads every demo topic, including ones created later, as group analytics-dashboard.
// ACLs it relies on: Read + Describe on topics prefixed `demo.`, Read on groups prefixed `analytics-`.
// The pattern subscription only matches topics the user may Describe, so other topics never show up.
import { kafkaAs, stopOnSignal } from "../kafka.ts";

const consumer = kafkaAs("analytics").consumer({ groupId: "analytics-dashboard" });
await consumer.connect();
await consumer.subscribe({ topics: [/^demo\./], fromBeginning: true });
const counts = new Map<string, number>();
await consumer.run({
  autoCommit: false,
  eachMessage: async ({ topic }) => {
    counts.set(topic, (counts.get(topic) ?? 0) + 1);
  },
});
const report = setInterval(() => console.log("analytics", Object.fromEntries(counts)), 2000);
console.log("analytics is consuming demo.* as group analytics-dashboard. Ctrl-C to stop.");
stopOnSignal(async () => {
  clearInterval(report);
  await consumer.disconnect();
});

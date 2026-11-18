// billing-service reads orders as consumer group demo-billing.
// ACLs it relies on: Read + Describe on topic demo.orders, Read on group demo-billing.
import { kafkaAs, stopOnSignal } from "../kafka.ts";

const consumer = kafkaAs("billing-service").consumer({ groupId: "demo-billing" });
await consumer.connect();
await consumer.subscribe({ topics: ["demo.orders"], fromBeginning: true });
await consumer.run({
  // Committing would erase the lag the seed gives demo-billing; a real service leaves this on.
  autoCommit: false,
  eachMessage: async ({ partition, message }) => {
    console.log(`billing  p${partition}@${message.offset}  ${message.key?.toString()}  ${message.value?.toString()}`);
  },
});
console.log("billing-service is consuming demo.orders as group demo-billing. Ctrl-C to stop.");
stopOnSignal(() => consumer.disconnect());

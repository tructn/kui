// payments writes one payment every two seconds, each in its own transaction.
// ACLs it relies on: Write + Describe on transactional IDs prefixed `payments-`, Write + Describe on topic
// demo.payments, IdempotentWrite on the cluster.
import { Partitioners } from "kafkajs";

import { kafkaAs, stopOnSignal } from "../kafka.ts";

const producer = kafkaAs("payments").producer({
  transactionalId: "payments-writer",
  idempotent: true,
  maxInFlightRequests: 1,
  createPartitioner: Partitioners.DefaultPartitioner,
});
await producer.connect();
console.log("payments is producing to demo.payments as transactional ID payments-writer. Ctrl-C to stop.");

let running = true;
stopOnSignal(async () => {
  running = false;
  await producer.disconnect();
});
for (let n = 1; running; n++) {
  const transaction = await producer.transaction();
  const payment = { id: `pay-${Date.now()}`, amount: (n * 37) % 500, currency: "USD" };
  await transaction.send({ topic: "demo.payments", messages: [{ key: payment.id, value: JSON.stringify(payment) }] });
  await transaction.commit();
  console.log("payments committed", payment);
  await new Promise((resolve) => setTimeout(resolve, 2000));
}

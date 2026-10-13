#!/usr/bin/env bash
# Creates demo data: topic `demo.orders` with 50 JSON messages, a compacted
# `demo.customers` topic, and consumer group `demo-billing` that has read 30
# of the 50 orders (so it shows lag). Skips everything if already seeded.
set -euo pipefail
BIN=/opt/kafka/bin
BOOTSTRAP=${BOOTSTRAP:-kafka:29092}

if $BIN/kafka-topics.sh --bootstrap-server "$BOOTSTRAP" --list | grep -qx demo.orders; then
  echo "Already seeded."
  exit 0
fi

$BIN/kafka-topics.sh --bootstrap-server "$BOOTSTRAP" --create --topic demo.orders --partitions 3
$BIN/kafka-topics.sh --bootstrap-server "$BOOTSTRAP" --create --topic demo.customers --partitions 1 \
  --config cleanup.policy=compact

statuses=(NEW PAID SHIPPED)
for i in $(seq 1 50); do
  echo "order-$i|{\"orderId\":\"order-$i\",\"customer\":\"cust-$((i % 7))\",\"total\":$((i * 13 % 500)).99,\"status\":\"${statuses[$((i % 3))]}\"}"
done | $BIN/kafka-console-producer.sh --bootstrap-server "$BOOTSTRAP" --topic demo.orders \
  --reader-property parse.key=true --reader-property key.separator='|'

for i in $(seq 0 6); do
  echo "cust-$i|{\"id\":\"cust-$i\",\"name\":\"Customer $i\"}"
done | $BIN/kafka-console-producer.sh --bootstrap-server "$BOOTSTRAP" --topic demo.customers \
  --reader-property parse.key=true --reader-property key.separator='|'

# Consume 30 messages; offsets are committed when the consumer closes.
$BIN/kafka-console-consumer.sh --bootstrap-server "$BOOTSTRAP" --topic demo.orders \
  --group demo-billing --from-beginning --max-messages 30 > /dev/null

echo "Seeded demo.orders, demo.customers and consumer group demo-billing."

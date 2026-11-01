#!/usr/bin/env bash
# Creates demo data:
#   demo.orders     50 flat JSON orders; consumer group `demo-billing` has read 30 (so it shows lag)
#   demo.customers  compacted, 7 customers
#   demo.events     60 nested, mixed-shape events with headers, for trying the message query
# Each topic is created only if missing, so re-running adds new demo topics to an old broker.
set -euo pipefail
BIN=/opt/kafka/bin
BOOTSTRAP=${BOOTSTRAP:-kafka:29092}

existing=$($BIN/kafka-topics.sh --bootstrap-server "$BOOTSTRAP" --list)
has_topic() { grep -qx "$1" <<<"$existing"; }

if has_topic demo.orders; then
  echo "demo.orders already seeded."
else
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
fi

# One event per line: `headers<TAB>key|json`. Six shapes, by i % 6:
#   0  order.created v2   customer.address.geo, items[] of objects with nested attributes, payment.card
#   1  order.created v1   older schema: flat customerId, items[].productId, no payment
#   2  payment.failed     error.retry.*, and `meta` is a string holding JSON
#   3  user.updated       quoted names ("first name", last-name), prefs 3 levels deep, changes[]
#   4  sensor.reading     deep path (a.b.c.d.e.f.g.h.i.j, past the catalog's depth limit), arrays of numbers
#   5  plain-text log     not JSON at all
events() {
  local sources=(web ios android) tiers=(gold silver bronze) cities=(Hanoi Berlin Austin Lagos)
  local countries=(VN DE US NG) brands=(visa mastercard amex) colors=(red green blue)
  for i in $(seq 1 60); do
    local src=${sources[$((i % 3))]} n=$((i % 4)) ts="2026-10-$(printf %02d $((i % 28 + 1)))T$(printf %02d $((i % 24))):15:00Z"
    local headers="x-source:$src,x-trace-id:trace-$i,content-type:application/json"
    case $((i % 6)) in
      0) printf '%s\tevt-%s|%s\n' "$headers" "$i" "{\"type\":\"order.created\",\"version\":2,\"id\":\"ord-$i\",\"occurredAt\":\"$ts\",\
\"customer\":{\"id\":\"cust-$((i % 7))\",\"email\":\"user$((i % 7))@example.com\",\"tier\":\"${tiers[$((i % 3))]}\",\"vip\":$([ $((i % 4)) = 0 ] && echo true || echo false),\
\"address\":{\"city\":\"${cities[$n]}\",\"country\":\"${countries[$n]}\",\"geo\":{\"lat\":$((10 + n * 7)).5,\"lng\":$((100 - n * 30)).25}},\"tags\":[\"${tiers[$((i % 3))]}\",\"$src\"]},\
\"items\":[{\"sku\":\"SKU-$((i % 5))\",\"qty\":$((i % 5 + 1)),\"price\":$((i * 7 % 90 + 10)).0,\"attributes\":{\"color\":\"${colors[$((i % 3))]}\",\"size\":\"M\"}},\
{\"sku\":\"SKU-$((i % 3 + 5))\",\"qty\":$((i % 3 + 1)),\"price\":$((i * 11 % 200 + 5)).5,\"attributes\":{\"color\":\"${colors[$(((i + 1) % 3))]}\",\"size\":\"L\",\"gift\":{\"wrap\":true,\"message\":\"Happy day $i\"}}}],\
\"payment\":{\"method\":\"card\",\"card\":{\"brand\":\"${brands[$((i % 3))]}\",\"last4\":\"$((4000 + i))\"}},\
\"totals\":{\"subtotal\":$((i * 9 % 400 + 20)).0,\"tax\":$((i % 30)).5,\"currency\":\"USD\"},\"notes\":null}" ;;
      1) printf '%s\tevt-%s|%s\n' "$headers" "$i" "{\"type\":\"order.created\",\"version\":1,\"id\":\"ord-$i\",\"occurredAt\":\"$ts\",\
\"customerId\":\"cust-$((i % 7))\",\"items\":[{\"productId\":$((100 + i % 9)),\"qty\":$((i % 4 + 1))}],\"total\":$((i * 5 % 300)).25}" ;;
      2) printf '%s\tevt-%s|%s\n' "$headers" "$i" "{\"type\":\"payment.failed\",\"id\":\"pay-$i\",\"orderId\":\"ord-$((i - 2))\",\"occurredAt\":\"$ts\",\
\"error\":{\"code\":\"$([ $((i % 4)) = 0 ] && echo CARD_DECLINED || echo INSUFFICIENT_FUNDS)\",\"message\":\"Payment for ord-$((i - 2)) was declined\",\
\"retry\":{\"attempts\":$((i % 5)),\"nextAt\":\"$ts\",\"backoff\":{\"strategy\":\"exponential\",\"baseMs\":500}}},\
\"meta\":\"{\\\"gateway\\\":\\\"stripe\\\",\\\"region\\\":\\\"${countries[$n]}\\\",\\\"latencyMs\\\":$((i * 17 % 900))}\"}" ;;
      3) printf '%s\tevt-%s|%s\n' "$headers" "$i" "{\"type\":\"user.updated\",\"occurredAt\":\"$ts\",\
\"user\":{\"id\":\"cust-$((i % 7))\",\"first name\":\"Ada$i\",\"last-name\":\"Lovelace\",\"age\":$((20 + i % 40)),\
\"prefs\":{\"locale\":\"$([ $((i % 2)) = 0 ] && echo en-US || echo vi-VN)\",\"notifications\":{\"email\":true,\"sms\":$([ $((i % 3)) = 0 ] && echo true || echo false),\"quietHours\":{\"from\":\"22:00\",\"to\":\"07:00\"}}}},\
\"changes\":[{\"field\":\"email\",\"from\":\"old$i@example.com\",\"to\":\"user$((i % 7))@example.com\"},{\"field\":\"prefs.locale\",\"from\":null,\"to\":\"en-US\"}]}" ;;
      4) printf '%s\tevt-%s|%s\n' "$headers" "$i" "{\"type\":\"sensor.reading\",\"device\":{\"id\":\"dev-$((i % 4))\",\"location\":{\"site\":\"plant-$n\",\"floor\":$((i % 3 + 1))}},\
\"readings\":[$((i % 50)),$((i * 3 % 70)),$((i * 7 % 90))],\"ok\":$([ $((i % 5)) = 0 ] && echo false || echo true),\
\"a\":{\"b\":{\"c\":{\"d\":{\"e\":{\"f\":{\"g\":{\"h\":{\"i\":{\"j\":\"deep-$i\"}}}}}}}}}}" ;;
      5) printf '%s\tlog-%s|%s\n' "x-source:$src,x-trace-id:trace-$i,content-type:text/plain" "$i" \
        "$([ $((i % 4)) = 1 ] && echo "WARN connection reset by peer (attempt $i)" || echo "INFO heartbeat ok seq=$i")" ;;
    esac
  done
}

if has_topic demo.events; then
  echo "demo.events already seeded."
else
  $BIN/kafka-topics.sh --bootstrap-server "$BOOTSTRAP" --create --topic demo.events --partitions 3
  events | $BIN/kafka-console-producer.sh --bootstrap-server "$BOOTSTRAP" --topic demo.events \
    --reader-property parse.headers=true --reader-property parse.key=true --reader-property key.separator='|'
  echo "Seeded demo.events."
fi

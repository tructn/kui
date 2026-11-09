#!/usr/bin/env bash
# Creates demo data:
#   demo.orders     50 flat JSON orders; consumer group `demo-billing` has read 30 (so it shows lag)
#   demo.customers  compacted, 7 customers
#   demo.events     60 nested, mixed-shape events with headers, for trying the message query
#   demo.analytics  40 tracking events whose `properties` is JSON written as a string
#   demo.catalog    30 wide product documents: dynamic-key maps, arrays of arrays, mixed arrays, edge-case numbers
#   demo.webhooks   40 webhook envelopes whose payload is JSON encoded 2-3 levels deep, base64 or NDJSON
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

# A JSON string literal holding $1, as producers that double-encode write it.
# sed does the escaping: bash's ${s//…} is quadratic on the ~20 KB bulk payloads.
json_string() {
  local s
  s=$(printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')
  printf '"%s"' "${s//$'\n'/\\n}"
}

# One event per line: `headers<TAB>key|json`, headers as `name=value;…` (header values hold JSON).
# Four shapes, by i % 4; `properties` is a string holding JSON except in shape 1:
#   0  checkout   properties: cart[] of objects, page, tags (an array, itself a JSON string) and
#                 context (a JSON string inside the JSON string); x-context header is JSON too
#   1  checkout   older SDK: the same properties as a real object, so one field has both forms
#   2  identify   traits: pretty-printed JSON string with quotes and accents; properties is
#                 "[INFO] …" and note is "{draft" (they look like JSON but aren't, so stay strings)
#   3  bulk       properties: 300 line items in one string (~20 KB), for checking filter speed
analytics() {
  local plans=(free pro team) countries=(VN DE US NG) skus=(SKU-1 SKU-2 SKU-3 SKU-4 SKU-5)
  for i in $(seq 1 40); do
    local n=$((i % 4)) user="user-$((i % 9))"
    local context="{\"ip\":\"10.0.$n.$i\",\"geo\":{\"cc\":\"${countries[$n]}\",\"tz\":\"UTC+$n\"},\"device\":{\"os\":\"$([ $((i % 2)) = 0 ] && echo ios || echo android)\",\"build\":$((100 + i))}}"
    local tags="[\"${plans[$((i % 3))]}\",\"$([ $((i % 5)) = 0 ] && echo beta || echo stable)\"]"
    local cart="[{\"sku\":\"${skus[$((i % 5))]}\",\"qty\":$((i % 4 + 1)),\"price\":$((i * 7 % 90 + 10)).5,\"options\":{\"gift\":$([ $((i % 3)) = 0 ] && echo true || echo false)}},\
{\"sku\":\"${skus[$(((i + 2) % 5))]}\",\"qty\":$((i % 6 + 1)),\"price\":$((i * 3 % 50 + 5)).0}]"
    local props="{\"page\":{\"url\":\"https://shop.example/cart?step=$((i % 3 + 1))\",\"title\":\"Cart \\\"$i\\\"\"},\
\"cart\":$cart,\"total\":$((i * 19 % 400 + 20)).25,\"currency\":\"USD\",\"tags\":$(json_string "$tags"),\"context\":$(json_string "$context")}"
    local headers="x-sdk=$([ $n = 1 ] && echo analytics-js@1 || echo analytics-js@2);x-context=$context"
    case $n in
      0) printf '%s\tevt-%s|%s\n' "$headers" "$i" "{\"type\":\"track\",\"event\":\"Checkout Started\",\"userId\":\"$user\",\"properties\":$(json_string "$props")}" ;;
      1) printf '%s\tevt-%s|%s\n' "$headers" "$i" "{\"type\":\"track\",\"event\":\"Checkout Started\",\"userId\":\"$user\",\"properties\":$props}" ;;
      2) local traits
        traits=$(printf '{\n  "name": "Nguyễn Văn %s",\n  "plan": "%s",\n  "quote": "says \\"hi\\"",\n  "address": {"city": "Hà Nội", "zip": "1000%s"}\n}' \
          "$i" "${plans[$((i % 3))]}" "$((i % 10))")
        printf '%s\tidt-%s|%s\n' "$headers" "$i" "{\"type\":\"identify\",\"userId\":\"$user\",\"traits\":$(json_string "$traits"),\
\"properties\":\"[INFO] identify from settings page\",\"note\":\"{draft\"}" ;;
      3) local items="" j
        for j in $(seq 1 300); do items+="${items:+,}{\"line\":$j,\"sku\":\"BULK-$((j % 50))\",\"qty\":$(((i + j) % 9 + 1))}"; done
        printf '%s\tblk-%s|%s\n' "$headers" "$i" "{\"type\":\"track\",\"event\":\"Order Imported\",\"userId\":\"$user\",\
\"properties\":$(json_string "{\"batch\":$i,\"items\":[$items],\"context\":$(json_string "$context")}")}" ;;
    esac
  done
}

if has_topic demo.analytics; then
  echo "demo.analytics already seeded."
else
  $BIN/kafka-topics.sh --bootstrap-server "$BOOTSTRAP" --create --topic demo.analytics --partitions 3
  analytics | $BIN/kafka-console-producer.sh --bootstrap-server "$BOOTSTRAP" --topic demo.analytics \
    --reader-property parse.headers=true --reader-property headers.separator=';' \
    --reader-property headers.key.separator='=' \
    --reader-property parse.key=true --reader-property key.separator='|'
  echo "Seeded demo.analytics."
fi

# One document per line: `key|json`. Every product has the same wide shape; each fifth one also has
# `reviews` nested ten levels deep through user.profile.social.links[].
#   price.tiers[]            open-ended last tier (`max: null`)
#   variants[].stock         warehouses is a map with dynamic keys, two levels below the array
#   matrix, mixed            array of arrays; array mixing numbers, strings, null, bool, object, array
#   attrs                    keys with a dot and a space, which the query catalog has to quote
#   empty, numbers           empty containers, ints past 2^53, negatives, exponents, zero
catalog() {
  local cities=(hanoi berlin austin lagos) colors=(red green blue) sizes=(S M L XL)
  for i in $(seq 1 30); do
    local c=${colors[$((i % 3))]} w=$((i % 40 + 10)) reviews=""
    if [ $((i % 5)) = 0 ]; then
      reviews=",\"reviews\":[{\"stars\":$((i % 5 + 1)),\"user\":{\"id\":\"user-$((i % 9))\",\"profile\":{\"bio\":{\"lang\":\"vi\",\"text\":\"Rất tốt “${i}”\"},\
\"social\":{\"links\":[{\"type\":\"web\",\"url\":\"https://example.com/u/$i\",\"meta\":{\"verified\":true,\"checks\":[{\"at\":\"2026-11-01\",\"by\":{\"bot\":\"v$i\"}}]}}]}}}}]"
    fi
    printf 'SKU-%s|%s\n' "$i" "{\"sku\":\"SKU-$i\",\"name\":\"Product $i – Ünïcode ☕ 🚀\",\"active\":$([ $((i % 7)) = 0 ] && echo false || echo true),\
\"price\":{\"amount\":$((i * 13 % 200 + 5)).99,\"currency\":\"USD\",\"tiers\":[{\"min\":1,\"max\":9,\"unit\":$((i % 9 + 10)).5},{\"min\":10,\"max\":99,\"unit\":$((i % 9 + 8)).0},{\"min\":100,\"max\":null,\"unit\":$((i % 9 + 6)).25}]},\
\"dimensions\":{\"cm\":{\"w\":$w,\"h\":$((w + 5)),\"d\":$((w / 2))},\"in\":{\"w\":$((w * 10 / 25)).$((w % 10)),\"h\":$(((w + 5) * 10 / 25)).$((w % 10))}},\
\"variants\":[{\"id\":\"v1\",\"options\":{\"color\":\"$c\",\"size\":\"${sizes[$((i % 4))]}\"},\"stock\":{\"warehouses\":{\"${cities[$((i % 4))]}\":{\"onHand\":$((i * 3 % 50)),\"reserved\":$((i % 5)),\"bins\":[\"A-$((i % 9))\",\"B-$((i % 4))\"]},\"${cities[$(((i + 1) % 4))]}\":{\"onHand\":$((i * 7 % 80)),\"reserved\":0,\"bins\":[]}}}},\
{\"id\":\"v2\",\"options\":{\"color\":\"${colors[$(((i + 1) % 3))]}\"},\"stock\":{\"warehouses\":{}}}],\
\"matrix\":[[1,2,3],[4,$i,6],[7,8,[9,[10]]]],\"mixed\":[$i,\"two\",null,true,{\"k\":\"v\",\"n\":{\"deep\":[1,{\"x\":null}]}},[1,[2,[3]]]],\
\"labels\":{\"en\":\"Product $i\",\"vi\":\"Sản phẩm $i\",\"de\":\"Produkt $i\"},\"attrs\":{\"a.b\":$i,\"with space\":\"x\",\"x-y\":[{\"z.z\":1}]},\
\"empty\":{\"obj\":{},\"arr\":[],\"str\":\"\"},\"numbers\":{\"big\":9007199254740993,\"neg\":-0.$((i % 9 + 1)),\"exp\":1.5e$((i % 9 + 1)),\"zero\":0,\"float\":$i.000001}$reviews}"
  done
}

if has_topic demo.catalog; then
  echo "demo.catalog already seeded."
else
  $BIN/kafka-topics.sh --bootstrap-server "$BOOTSTRAP" --create --topic demo.catalog --partitions 3
  catalog | $BIN/kafka-console-producer.sh --bootstrap-server "$BOOTSTRAP" --topic demo.catalog \
    --reader-property parse.key=true --reader-property key.separator='|'
  echo "Seeded demo.catalog."
fi

# One event per line: `headers<TAB>key|json`, same header format as analytics. Four shapes, by i % 4:
#   0  billing   payload: JSON string; its data.object.metadata is another JSON string (three levels)
#   1  vcs       payload: a real object, but `body` is that JSON, base64 encoded
#   2  batch     records: NDJSON in one string (newline-separated documents, one with a nested string)
#   3  misc      scalars written as strings ("42", "true", "null", "[1,2,3]") plus broken JSON that stays text
webhooks() {
  local evts=(invoice.paid charge.failed customer.created) countries=(VN DE US NG)
  for i in $(seq 1 40); do
    local n=$((i % 4)) ts="2026-11-$(printf %02d $((i % 28 + 1)))T$(printf %02d $((i % 24))):30:00Z" evt=${evts[$((i % 3))]}
    local meta="{\"campaign\":{\"id\":\"cmp-$((i % 5))\",\"utm\":{\"source\":\"mail\",\"medium\":\"cpc\"}},\"seats\":$((i % 8 + 1))}"
    local headers="x-event=$evt;x-delivery=dlv-$i;content-type=application/json"
    case $n in
      0) local inner="{\"type\":\"$evt\",\"data\":{\"object\":{\"id\":\"in_$i\",\"amount\":$((i * 137 % 9000 + 100)),\"lines\":[{\"sku\":\"SKU-$((i % 5))\",\"qty\":$((i % 3 + 1))}],\"metadata\":$(json_string "$meta")}}}"
        printf '%s;x-meta=%s\twh-%s|%s\n' "$headers" "$meta" "$i" "{\"id\":\"wh-$i\",\"source\":\"billing\",\"receivedAt\":\"$ts\",\"payload\":$(json_string "$inner")}" ;;
      1) local body b64
        body="{\"ref\":\"refs/heads/main\",\"commits\":[{\"id\":\"c$i\",\"author\":{\"name\":\"Ada $i\",\"emails\":[\"ada$i@example.com\"]},\"files\":{\"added\":[\"a$i.rs\"],\"removed\":[]}}]}"
        b64=$(printf '%s' "$body" | base64 | tr -d '\n')
        printf '%s\twh-%s|%s\n' "$headers" "$i" "{\"id\":\"wh-$i\",\"source\":\"vcs\",\"receivedAt\":\"$ts\",\"payload\":{\"event\":\"push\",\"repo\":{\"owner\":{\"login\":\"acme\"},\"name\":\"kui\"}},\"body\":\"$b64\",\"encoding\":\"base64\"}" ;;
      2) local records="" j
        for j in 1 2 3; do records+="${records:+$'\n'}{\"seq\":$j,\"user\":\"user-$(((i + j) % 9))\",\"extra\":$(json_string "{\"k\":$j,\"ok\":true}")}"; done
        printf '%s\twh-%s|%s\n' "$headers" "$i" "{\"id\":\"wh-$i\",\"source\":\"batch\",\"receivedAt\":\"$ts\",\"records\":$(json_string "$records")}" ;;
      3) printf '%s\twh-%s|%s\n' "$headers" "$i" "{\"id\":\"wh-$i\",\"source\":\"misc\",\"receivedAt\":\"$ts\",\"count\":\"$i\",\"ok\":\"$([ $((i % 2)) = 0 ] && echo true || echo false)\",\"nothing\":\"null\",\
\"ids\":$(json_string "[$i,$((i + 1)),$((i + 2))]"),\"region\":\"${countries[$((i % 4))]}\",\"empty\":\"\",\"truncated\":$(json_string "{\"a\":{\"b\":[1,2"),\"version\":\"1.$i.0\"}" ;;
    esac
  done
}

if has_topic demo.webhooks; then
  echo "demo.webhooks already seeded."
else
  $BIN/kafka-topics.sh --bootstrap-server "$BOOTSTRAP" --create --topic demo.webhooks --partitions 3
  webhooks | $BIN/kafka-console-producer.sh --bootstrap-server "$BOOTSTRAP" --topic demo.webhooks \
    --reader-property parse.headers=true --reader-property headers.separator=';' \
    --reader-property headers.key.separator='=' \
    --reader-property parse.key=true --reader-property key.separator='|'
  echo "Seeded demo.webhooks."
fi

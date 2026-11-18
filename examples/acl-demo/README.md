# ACL demo

Kafka clients that log in as the demo users seeded by `bun run kafka:up`, to show the seeded ACLs being enforced.
They connect to the dev broker's SASL/PLAIN listener on `localhost:9094`. On `localhost:9092` every client is a
super user and ACLs are bypassed. [docs/LOCAL_KAFKA.md](../../docs/LOCAL_KAFKA.md) lists the users and their ACLs.

Written in TypeScript with [KafkaJS](https://kafka.js.org), run with [Bun](https://bun.sh):

```bash
bun run kafka:up                # from the repo root, once
cd examples/acl-demo
bun install
bun run check                   # or `bun run kafka:acl-demo` from the repo root
```

## The check

`check.ts` tries one thing per line as one user, and compares what the broker did with what the ACLs say. It
exits 1 if any line doesn't match, so it also catches an ACL that was deleted or changed by mistake.

| Section                     | What it shows                                                                           |
|-----------------------------|-----------------------------------------------------------------------------------------|
| Literal topic and group     | `billing-service` reads `demo.orders` in group `demo-billing`, and nothing else         |
| Prefixed                    | `analytics` reads any `demo.*` topic, but only in `analytics-*` groups                  |
| Transactional producer      | `payments` writes in a `payments-*` transaction, not under another transactional ID     |
| DENY beats ALLOW            | `intern` is allowed to write `demo.*`, but the DENY on every topic wins                 |
| Wildcard Describe, no ACLs  | `auditor` sees every topic but can't write; `nobody` sees nothing                       |
| Authentication              | A wrong password is refused before any ACL is checked                                   |

A consumer needs ACLs on both the topic and the group. That's why `billing-service` reading `demo.orders` as
`billing-replay` is denied: the topic is allowed, the group isn't.

The check never commits offsets, so `demo-billing` keeps the lag the seed gives it. It only writes to
`demo.payments`, and only as users allowed to. The groups it joins (`analytics-dashboard`,
`intern-onboarding`) stay behind as empty groups.

## The services

One small program per demo user, written the way that service would use Kafka. The comment at the top of each
lists the ACLs it relies on. Run one, then watch it in KUI: its group, members and lag show up on the Consumer
groups page.

```bash
bun run billing     # consumes demo.orders as group demo-billing
bun run analytics   # consumes every demo.* topic, via a pattern subscription, as group analytics-dashboard
bun run payments    # transactional producer: one payment every 2 s to demo.payments
bun run auditor     # read-only report of every topic and group
```

Ctrl-C stops a service and leaves its group cleanly. The consumers don't commit offsets either, so you can run
them again and again.

Try breaking one: delete one of its ACLs in KUI, or change the topic or group in `services/billing.ts`, and start
it again. A denied topic fails with `TOPIC_AUTHORIZATION_FAILED`. A denied group fails with "Failed to find group
coordinator" (see the notes below).

## Notes

- Bun prints a `TimeoutNegativeWarning` once per run. KafkaJS schedules a timer with a negative delay. It's
  harmless and is clamped to 1 ms.
- When a group is denied, KafkaJS throws a generic "Failed to find group coordinator" and only logs the broker's
  `GROUP_AUTHORIZATION_FAILED` at debug level. `check.ts` reads it from the log so it can report "denied". A
  service you write yourself sees the generic error.
- KafkaJS is no longer actively maintained. It's used here because it's plain JavaScript and installs in a
  second. Confluent's [`@confluentinc/kafka-javascript`](https://github.com/confluentinc/confluent-kafka-javascript)
  offers the same API on librdkafka, but it compiles librdkafka on Node versions it has no prebuilt binary for.

# Local Kafka

`docker-compose.yml` runs a single-node KRaft broker for development, and a separate throwaway one for the e2e
suite. Both are seeded by [`docker/kafka-seed.sh`](../docker/kafka-seed.sh).

```bash
bun run kafka:up                       # broker on localhost:9092 (+ 9094 for demo logins), then seeds it
bun run kafka:down                     # stop and remove everything, data included
docker compose run --rm kafka-seed     # re-run the seed against the running broker
bun run kafka:acl-demo                 # prove the seeded ACLs are enforced (see below)
```

In KUI, add a cluster with bootstrap `localhost:9092` and no authentication.

| Listener         | Who you are                         | ACLs                                    |
|------------------|-------------------------------------|-----------------------------------------|
| `localhost:9092` | `User:ANONYMOUS`, a super user      | bypassed: use it to browse and manage   |
| `localhost:9094` | a demo login, over SASL/PLAIN       | enforced: use it to see what a user can |
| `kafka:29092`    | `User:ANONYMOUS`, other containers  | bypassed                                |

## Demo data

| Topic            | What it's for                                                                                |
|------------------|----------------------------------------------------------------------------------------------|
| `demo.orders`    | 50 flat JSON orders. Consumer group `demo-billing` has read 30, so it shows lag              |
| `demo.customers` | 7 customers on a compacted topic                                                             |
| `demo.events`    | 60 nested events of six shapes, with headers, for trying the message query                   |
| `demo.analytics` | 40 tracking events whose `properties` is JSON written as a string                            |
| `demo.catalog`   | 30 wide product documents: dynamic-key maps, arrays of arrays, edge-case numbers             |
| `demo.webhooks`  | 40 webhook envelopes with JSON encoded 2-3 levels deep, base64 or NDJSON                     |
| `demo.untrusted` | HTML and script payloads in keys, values and headers. The e2e suite checks they render inert |
| `demo.payments`  | Starts empty. The only topic the ACL demo writes to, as `payments`                           |

The seed only creates a topic, or the ACL set, when it's missing. Re-running it after pulling new seed data
adds what's new without duplicating what's there.

## ACLs

### How the brokers are set up

ACLs need an authorizer on the broker. Without one, the ACLs page shows "This cluster has no authorizer". Both
compose brokers set:

```yaml
KAFKA_AUTHORIZER_CLASS_NAME: org.apache.kafka.metadata.authorizer.StandardAuthorizer
KAFKA_SUPER_USERS: User:ANONYMOUS
```

On the PLAINTEXT listeners every client (KUI, the seed, the controller itself) connects as `User:ANONYMOUS`.
As a super user it skips ACL checks, so you can add any ACL, including DENY rules, and still use the cluster.

The dev broker also has a SASL/PLAIN listener on `localhost:9094` with one login per demo principal. Those users
aren't super users, so there the ACLs decide:

| Login             | Password                                  |
|-------------------|-------------------------------------------|
| `billing-service` | `billing-service-secret`                  |
| `order-service`   | `order-service-secret`                    |
| `analytics`       | `analytics-secret`                        |
| `payments`        | `payments-secret`                         |
| `auditor`         | `auditor-secret`                          |
| `intern`          | `intern-secret`                           |
| `nobody`          | `nobody-secret` (has no ACLs at all)      |

They're listed in `KAFKA_LISTENER_NAME_SASL_PLAIN_SASL_JAAS_CONFIG` in `docker-compose.yml`. They are
demo credentials, on a port bound to your machine, for a broker you throw away. Don't reuse them. The e2e broker
has no SASL listener; its specs only need ACLs to exist.

To see the cluster through a user's eyes, add a second cluster in KUI with bootstrap `localhost:9094`, security
protocol `SASL_PLAINTEXT`, mechanism `PLAIN` and one of the logins above:

- `auditor` sees every topic and group and can list the ACLs, but any produce or delete is refused.
- `analytics` sees only the `demo.` topics.
- `nobody` sees no topics, and the ACLs page reports it lacks Describe on the cluster.

On a real cluster, set the same properties in each broker's `server.properties`
(`authorizer.class.name=org.apache.kafka.metadata.authorizer.StandardAuthorizer` for KRaft), and list your admin
principals in `super.users` before restarting, or you'll lock them out.

### Seeded ACLs

Each row of the ACLs page has one principal, operation and resource. The seed creates 30 of them, chosen so that
every column and filter has something to show, and so the [ACL demo](#proving-the-acls-are-enforced) has
something to prove:

| Principal                         | Permission | Operations                    | Resource                          | Host           |
|-----------------------------------|------------|-------------------------------|-----------------------------------|----------------|
| `billing-service`                 | Allow      | Read, Describe                | topic `demo.orders`               | `*`            |
| `billing-service`                 | Allow      | Read                          | group `demo-billing`              | `*`            |
| `order-service`                   | Allow      | Write, Describe               | topic `demo.orders`               | `*`            |
| `order-service`                   | Allow      | Read                          | topic `demo.customers`            | `*`            |
| `analytics`, `data-science`       | Allow      | Read, Describe                | topic prefix `demo.`              | `*`            |
| `analytics`                       | Allow      | Read                          | group prefix `analytics-`         | `*`            |
| `payments`                        | Allow      | Write, Describe               | txn ID prefix `payments-`         | `*`            |
| `payments`                        | Allow      | IdempotentWrite               | cluster                           | `*`            |
| `payments`                        | Allow      | Write, Describe               | topic `demo.payments`             | `*`            |
| `auditor`                         | Allow      | Describe, DescribeConfigs     | topic `*`                         | `*`            |
| `auditor`                         | Allow      | Describe                      | group `*`                         | `*`            |
| `auditor`                         | Allow      | Describe, DescribeConfigs     | cluster                           | `*`            |
| `ops`                             | Allow      | Alter, AlterConfigs           | cluster                           | `10.0.0.5`     |
| `intern`                          | Allow      | Read, Write, Describe         | topic prefix `demo.`              | `*`            |
| `intern`                          | Allow      | Read                          | group prefix `intern-`            | `*`            |
| `intern`                          | Deny       | Write, Delete                 | topic `*`                         | `*`            |
| `legacy-app`                      | Deny       | Read                          | topic `demo.untrusted`            | `192.168.1.10` |

All principals are `User:` principals. Some things to try in the UI:

- Filter by `auditor` to see the wildcard (`*`) resource names.
- Filter by `demo.` to see a prefixed pattern next to the literal `demo.orders` ACLs.
- Filter by `10.0.0.5` or `192.168.1.10` to see host restrictions.
- Filter by `intern` to see an Allow and a Deny that both cover writing to `demo.payments`. The Deny wins.

`data-science`, `ops` and `legacy-app` have no login, and the host-restricted rules can't be triggered from your
machine, so those rows are only for display.

The seed skips the ACLs if `User:billing-service` still has any. Deleting a few seeded ACLs in the UI won't undo
itself on the next `kafka:up`. Delete all of `billing-service`'s ACLs, or run `kafka:down`, to get the full set
back.

The e2e broker is seeded with the same ACLs. The ACL specs create their own principal with `uniqueName()` and
only count rows for it, so the seeded ACLs don't change the counts they check. Keep new specs scoped the same way.

### Proving the ACLs are enforced

[`examples/acl-demo`](../examples/acl-demo) is a small TypeScript project (KafkaJS, run with Bun) that logs in
on `localhost:9094` as the demo users:

```bash
bun run kafka:acl-demo
```

It tries 18 actions, compares each one with what the ACLs say should happen, and exits 1 on any mismatch:

```text
Literal topic and group ACLs
  ok    billing-service  read demo.orders as group demo-billing                   allowed
  ok    billing-service  read demo.orders as group billing-replay                 denied
  ...
DENY beats ALLOW: the intern may use demo.*, but writes to any topic are denied
  ok    intern           read demo.customers as group intern-onboarding           allowed
  ok    intern           write to demo.payments                                   denied
  ...
Every check matched the ACLs.
```

Delete an ACL in KUI (say, `billing-service`'s Read on group `demo-billing`) and run it again: that check
turns into a `FAIL`. The project also has one long-running example per service, see its
[README](../examples/acl-demo/README.md).

### Managing ACLs from the command line

The compose broker ships with Kafka's CLI tools. Use them to check what KUI did, or to set up a case the seed
doesn't cover:

```bash
acls() { docker exec kui-kafka /opt/kafka/bin/kafka-acls.sh --bootstrap-server localhost:9092 "$@"; }

acls --list                                   # everything
acls --list --principal User:auditor          # one principal
acls --list --topic demo.orders               # one resource

# Allow a consumer to read every topic starting with `audit.`, using any group starting with `audit-`
acls --add --allow-principal User:audit-reader --operation Read --operation Describe \
  --topic audit. --group audit- --resource-pattern-type prefixed

# Deny writes from one host
acls --add --deny-principal User:batch --deny-host 10.1.2.3 --operation Write --topic demo.events

# Remove an ACL. Without --force it asks for confirmation.
acls --remove --force --allow-principal User:audit-reader --operation Read --topic audit. \
  --resource-pattern-type prefixed
```

`--resource-pattern-type` defaults to `literal`, so `acls --list --topic audit.` finds nothing for the
prefixed ACL above. Pass `prefixed` to reach it, or `any` / `match` when listing. KUI's delete always repeats every field of the ACL, so it removes
exactly one ACL and never acts as a filter.

### Adding to the seed

ACLs live at the end of `docker/kafka-seed.sh`, inside the `billing-service` check. Add an `acl ...` line there.
It takes the same arguments as `kafka-acls.sh --add`. A new principal also needs a login in
`docker-compose.yml` and in the `DemoUser` type in `examples/acl-demo/kafka.ts`, and a check in
`examples/acl-demo/check.ts` that shows what the ACL allows and what it doesn't. Group operations on one resource into a single call, since
each call starts a JVM and adds a second or two to every fresh `kafka:up`. To get a new ACL onto an existing dev
broker, either delete `billing-service`'s ACLs or run `kafka:down` first.

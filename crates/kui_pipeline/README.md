# kui_pipeline

KUI's **pipelines**, independent of the app. A pipeline is designed and tested in KUI, and runs either in KUI's own
Rust engine or, translated, on another tool's servers:

```text
        KUI (Tauri)           graph editor · replay and dry run · publish
             │
             ▼
     Pipeline IR              model · validate · file      ← one definition, checked once
             │
     ┌───────┴──────────────────────────────┐
     ▼                                      ▼
 Native engine                         Backends (export)
 router · body · replay                Kafka Connect  ·  Airflow, dbt (later)
```

Reading the topic, keeping pipelines, sending requests and talking to servers stay in
`crates/kui_desktop/src/features/automations`. This crate has no Kafka client, Tauri or network dependencies, so
every rule is unit-tested. A message comes in as a `template::Event`, and filters are matched through
`kui_mql::Record`.

| Layer | Module | What it does |
| --- | --- | --- |
| IR | `model` | `Pipeline`, `Route`, `Action`, `Webhook` and the body types. The app adds an id, a cluster and an on/off switch |
| IR | `validate` | Whether a pipeline is well formed. Runners and backends may assume a pipeline that passed it. Credentials aren't checked: what makes a URL sendable is the HTTP client's business |
| IR | `file` | Saves and opens a pipeline as a file, without its credentials. What `read` returns has passed `validate` |
| Engine | `router` | Parses the filters once and decides which routes a message takes. The live engine and replays both use it |
| Engine | `body`, `template`, `mapping` | Turn one message into the request bodies a route sends |
| Engine | `replay` | Runs a pipeline over existing messages, as a dry run or sending |
| Engine | `throttle` | The per-minute request limit |
| Backends | `export` | Turns a pipeline into another tool's configuration. Kafka Connect is the first backend |

## Bodies

| `Body` | What is sent |
| --- | --- |
| `Envelope` | The whole message as JSON: topic, partition, offset, time, key, value, headers |
| `Template` | Text with placeholders: `{"id": {{value.id \| json}}}` |
| `Mapping` | A new JSON object built field by field |

## Field mappings

Each `FieldMapping` reads a `Source`, optionally converts it with a `Transform`, and stores it at a dotted target
such as `customer.name`.

- `Field` reads `value.order.id`, `key`, `headers.x-source`, `topic`, ...
- `Fixed` is the same value every time, and `Template` is text with placeholders.
- `Each` maps a list item by item. Inside it, `item` is the current item and the message stays readable, so
  `{ sku: item.sku, order: value.id }` copies the order id onto every line. Lists nest up to four levels.

A value that isn't a list counts as a list of one. The transforms `count`, `join`, `first` and `last` turn a list
into a single value.

## Splitting

`body::render_all` with a split path such as `value.items` makes one body per item, with the item readable as
`item`, which is the same idea as `UNNEST` in SQL. A message with no items makes no requests.

## Pipeline files

`file::write` saves a pipeline as JSON, and `file::read` opens one:

```json
{ "kind": "kui.pipeline", "version": 1, "pipeline": { "name": "Order alerts", "topic": "orders", "routes": [] } }
```

Webhook URLs and header values are usually credentials, so a file never holds them. They are written blank, and
`read` blanks them again in case someone added them by hand, so they are always entered on the machine that runs
the pipeline. A file from a newer format version is refused with a message to update KUI.

## Replay

`replay::replay` runs a pipeline over messages in order, through the same `Router` and body rendering as the live
engine:

- Without a sender it is a **dry run**: every request comes back as `Planned` with its body.
- With a sender, at most the pipeline's `max_per_minute` requests go out in one replay. The rest are `Skipped`, so
  a replay can't flood a target.

`ReplayMessage` has the same shape as a record of KUI's message export, so `replay::parse_messages` reads an
exported JSON array or NDJSON file as it is. CSV isn't read.

## Export to Kafka Connect

`export::kafka_connect::compile` turns each route into a
[Confluent HTTP Sink](https://docs.confluent.io/kafka-connectors/http/current/overview.html) connector
(`io.confluent.connect.http.HttpSinkConnector`). The body is shaped with Kafka's built-in single message transforms,
so nothing has to be installed on the Connect workers except the HTTP Sink itself.

Only what Connect can run exactly is translated. Everything else is a **blocker**, listed all at once so the user
can fix them together. Things that run with a visible difference are **warnings**.

| In KUI | On Kafka Connect |
| --- | --- |
| Topic | `topics` |
| Webhook URL, method, headers | `http.api.url`, `request.method`, `headers` (with a `header.separator` no header uses) |
| One request per message | `batch.max.size=1`, `batch.json.as.array=false` |
| Failed requests and unreadable messages are counted and skipped | `behavior.on.error=log`, `errors.tolerance=all`, `errors.log.enable=true` |
| Body: whole message | `HoistField` wraps the value as `value`, `InsertField` adds topic, partition, offset, timestamp and the pipeline name. **Warning:** no key or headers |
| Mapping from `value.a` or `value.a.b` | `Flatten` (only for nested paths), then `ReplaceField` keeps and renames them |
| Mapping from `topic`, `partition`, `offset`, `timestamp` | `InsertField` |
| Fixed text | `InsertField` with a static value |
| To number, to text, to true/false | `Cast` |
| Epoch ms to date | `TimestampConverter` to `yyyy-MM-dd'T'HH:mm:ss.SSSXXX` |
| Rate limit | Not applied. **Warning** |
| Delivery | A new connector starts at the oldest message and delivers at least once. **Warning** |

Blockers: a pipeline or route filter (Connect has no MQL), one request per list item, body templates, a mapping
that reads the key or headers, uses a template or `Each`, sets a nested target or a default, uses another
transform, or reads the same field twice. Text fixed values only.

Every connector also gets `confluent.topic.bootstrap.servers` and `reporter.bootstrap.servers` from
`ConnectOptions`, because the Confluent connector keeps its license and delivery reports in Kafka. Extra properties
(such as `confluent.topic.security.protocol` for a secured cluster) are added, but may not replace a key the
pipeline sets.

`ConnectPlan::redacted` hides the webhook URL, header values and credential-like properties for display. The real
values are only sent when publishing.

### Adding a backend

A new backend, such as Airflow or dbt, is a new module under `export/` that takes a validated `Pipeline` and returns
its own plan with `warnings` and `blockers`, following the same rule: translate exactly or report a blocker. The
desktop app adds a command to preview it and one to publish it, and the publish command is listed in
`CHANGING_COMMANDS` (`e2e/helpers.ts`).

## Limits

These bound the work done for a hostile message:

| Limit | Value |
| --- | --- |
| Body template or mapping | 64 KiB |
| Fields across all levels | 100 |
| Items mapped per list | 1,000 |
| Requests per message | 100 (the rest count as dropped) |
| Messages per replay | 1,000 |
| Requests listed per replay | 200, bodies cut at 8 KiB (the counters cover all) |
| Pipeline file | 1 MiB |

Errors name the target field and never repeat a message value.

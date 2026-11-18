# Pipelines: design, test locally, publish

A pipeline watches a topic, filters messages with the query language, and sends each match to one or more
webhooks, shaped the way the receiver wants. You build and test it in KUI. When it's ready, it can keep running in
KUI, or you can publish it to Kafka Connect so it runs on your servers without KUI.

```text
  Design in KUI ──▶ Test locally ──▶ Run in KUI
   graph editor      dry run          while KUI is open
                     replay      └──▶ Publish to Kafka Connect
                                      runs on your Connect cluster
```

How it is built is in [`crates/kui_pipeline/README.md`](../crates/kui_pipeline/README.md).

## Save a pipeline as a file

On **Pipelines**, open a pipeline's **⋯** menu and choose **Save as file…**. You get a `.kui-pipeline.json` file to
commit next to the service it feeds, or to share with your team. **Open file** reads it back as a new pipeline.

The file never holds webhook URLs or header values, because these are usually credentials. After opening a file,
fill them in and save. A file from a newer KUI is refused with a message to update.

## Test with messages that already exist

A running pipeline only sees new messages. **Replay messages…** in the **⋯** menu runs it over messages that are
already there:

- **From the topic**: the newest or oldest messages, or those from a time, up to 1,000.
- **From an export file**: a JSON or NDJSON file from **Export** on the Messages page. Use this to keep a set of test
  messages, or to test against data from another environment without connecting to it.

**Dry run** sends nothing. It lists every request each route would make, with its body, so you can check filters
and mappings against real data. **Replay and send** calls the webhooks, at most the pipeline's per-minute limit in
one replay. Point the webhook at a local server (for example `http://localhost:3000/hook`) to test end to end.

## Publish to Kafka Connect

**Publish to Kafka Connect…** in the **⋯** menu turns each route into a
[Confluent HTTP Sink](https://docs.confluent.io/kafka-connectors/http/current/overview.html) connector and creates it
on your Kafka Connect cluster through its REST API. Publishing again updates the same connectors. Removing a route
does not delete its connector; delete it on the Connect cluster.

You need:

- A Kafka Connect cluster with the HTTP Sink installed (`confluent-hub install confluentinc/kafka-connect-http`).
  KUI checks for it before creating anything.
- Its REST URL, and a user name and password if it uses basic authentication. The password is only used for the
  request and is never saved.
- The bootstrap servers of this Kafka cluster as the Connect workers reach it. The Confluent connector keeps its
  license and delivery reports there. Use a replication factor of 1 on a single-broker cluster.
- For a secured cluster, extra properties such as `confluent.topic.security.protocol=SASL_SSL`. Extra properties
  are saved on this machine, so keep passwords out of them and configure those on the workers instead.

The Confluent HTTP Sink is a commercial connector. It runs for 30 days without a license key, and indefinitely on a
single-broker development cluster.

### What can be published

The dialog shows the connector configuration before you publish, with the URL and header values hidden. It lists
anything Kafka Connect can't run, so you can change all of it in one go, and anything that will behave differently.

| Works on Kafka Connect | Can't be published |
| --- | --- |
| Sending the whole message (without its key and headers) | A pipeline or route filter |
| Mapping fields of the value, nested ones included, to top-level names | One request per list item |
| Adding the topic, partition, offset, timestamp or fixed text | Body templates |
| Converting to a number, text, true/false, or epoch ms to a date | Reading the key or headers, mapping lists item by item, nested targets, defaults, other conversions |

Kafka Connect works differently from KUI in three ways:

- **No rate limit.** The per-minute limit isn't applied.
- **From the beginning.** A new connector starts at the oldest message the topic keeps, then delivers each message
  at least once. KUI only sends messages published while it runs.
- **JSON values only.** Values are read as JSON. A message that isn't JSON fails, and the connector logs it and
  carries on.

### Try it locally

```bash
bun run kafka:up        # Kafka on localhost:9092 with demo data
bun run kafka:connect   # adds Kafka Connect on localhost:8083 with the HTTP Sink installed
```

In the publish dialog, use `http://localhost:8083`, bootstrap servers `kafka:29092` and replication factor `1`.
The connector runs inside Docker, so a webhook on your machine is `http://host.docker.internal:<port>/...`. Check
the connector with `curl localhost:8083/connectors/<name>/status`. `bun run kafka:down` stops everything.

### Troubleshooting

- **The connector fails with `NoClassDefFoundError: io/confluent/license/...`.** Recent HTTP Sink releases no
  longer bundle Confluent's licensing classes. Install version 1.7.10
  (`confluent-hub install confluentinc/kafka-connect-http:1.7.10`), as the local setup does, or put the
  `confluent-licensing-new` jar of your Confluent Platform next to the connector.
- **Nothing reaches the webhook.** Check `GET /connectors/<name>/status` on the Connect cluster. The webhook URL
  has to be reachable from the Connect workers, not only from your machine.

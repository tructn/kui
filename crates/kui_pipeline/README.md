# kui_pipeline

The transform step of KUI's **pipelines**: it turns one Kafka message into the request bodies a pipeline sends.
Reading the topic and sending the requests stay in `crates/kui_desktop/src/features/automations`.

It has no Kafka, Tauri or network dependencies, so every rule is unit-tested. A message comes in as a
`template::Event`.

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

## Limits

These bound the work done for a hostile message:

| Limit | Value |
| --- | --- |
| Body template or mapping | 64 KiB |
| Fields across all levels | 100 |
| Items mapped per list | 1,000 |
| Requests per message | 100 (the rest count as dropped) |

Errors name the target field and never repeat a message value.

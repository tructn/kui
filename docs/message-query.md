# Message query

KUI filters a topic's messages with a SQL-like condition, the part of a query that would follow `WHERE`:

```sql
value.status = 'shipped' AND value.items[*].qty > 3
```

Type it in the filter bar above the message table and press **Enter** (or **Apply**). The filter applies to
browsing, to the **live tail**, and to **exports** of a range, so an export saves only the matching messages.

- [Using it](#using-it): syntax, operators, how messages of different shapes are handled
- [How it works](#how-it-works): the compiler, the search, and the suggestions, for contributors

---

## Using it

### Fields

Every condition starts from one of six message attributes:

| Field       | What it is                                                                      |
| ----------- | ------------------------------------------------------------------------------- |
| `key`       | The key: parsed JSON when it is JSON, otherwise its text                        |
| `value`     | The value (payload), the same way                                               |
| `headers`   | The headers; `headers.<name>` is one header's value                             |
| `partition` | Partition number                                                                |
| `offset`    | Offset within the partition                                                     |
| `timestamp` | Message time, in epoch milliseconds (compare it with a date, see [Dates](#dates)) |

Go inside JSON with paths:

| Path                        | Meaning                                                                    |
| --------------------------- | -------------------------------------------------------------------------- |
| `value.customer.name`       | Object fields                                                              |
| `value."first name"`        | A name with spaces, dots or other symbols, in double quotes (`""` = one `"`) |
| `value['first name']`       | The same, bracket style                                                    |
| `value.items[0]`            | An array element; `[-1]` is the last one                                   |
| `value.items[*].sku`        | **Every** element (the condition passes if any one of them matches)        |
| `value.items.sku`           | Same as `[*]`: a name applied to an array looks inside each element        |
| `headers.x-trace-id`        | Header names may contain `-`. Names are matched exactly, then ignoring case |
| `value.meta.source`         | Also works when `meta` is a **string** holding JSON (`"{\"source\":\"web\"}"`) |

### Operators

| Operator                        | Example                                    | Notes                                                    |
| ------------------------------- | ------------------------------------------ | -------------------------------------------------------- |
| `=` `!=` `<>`                   | `value.status = 'shipped'`                 | `==` also works                                          |
| `<` `<=` `>` `>=`               | `value.total >= 100`                       | Numbers, text, or dates                                  |
| `LIKE`, `ILIKE`                 | `key LIKE 'order-%'`                       | `%` any text, `_` one character, `\` escapes. `ILIKE` ignores case |
| `CONTAINS`                      | `value CONTAINS 'timeout'`                 | Text inside text, or an element of an array (below)      |
| `IN ( … )`                      | `headers.x-source IN ('web', 'ios')`       | Any of a list                                            |
| `BETWEEN … AND …`               | `offset BETWEEN 100 AND 200`               | Both ends included                                       |
| `IS NULL`, `IS NOT NULL`        | `value.error IS NOT NULL`                  | `NULL` = missing **or** JSON `null`. `= null` means the same |
| `NOT` before `LIKE`, `ILIKE`, `CONTAINS`, `IN`, `BETWEEN` | `value.tags NOT CONTAINS 'test'` |                                    |
| `AND`, `OR`, `NOT`, `( … )`     | `NOT (a OR b) AND c`                       | `NOT` binds tightest, then `AND`, then `OR`              |
| A field on its own              | `value.paid AND NOT value.deleted`         | True when present and not `null`, `false`, `0` or `''`   |

`CONTAINS` depends on what it's given:

- **Text:** a substring match (case-sensitive; use `lower(…)` to ignore case).
- **An array:** whether one element equals the value, so `value.tags CONTAINS 'vip'` matches `["vip", "eu"]` but `'vi'` doesn't.
- **A whole `key` or `value`:** searches the payload text **as it was sent**, so `value CONTAINS '"status": "failed"'` works when the JSON has that spacing.

Keywords are case-insensitive (`and` = `AND`). Field names are case-sensitive, except header names. An optional
leading `WHERE` is allowed.

### Values

| Kind      | Written as                                        |
| --------- | ------------------------------------------------- |
| Text      | `'single quotes'`; write `''` for a `'` inside     |
| Numbers   | `42`, `-1.5`, `2.5e3`, `1_000_000`                 |
| Booleans  | `true`, `false`                                    |
| Null      | `NULL`                                             |

### Functions

| Function       | Gives                                                                         |
| -------------- | ----------------------------------------------------------------------------- |
| `lower(x)`     | Text in lowercase: `lower(value.email) LIKE '%@example.com'`                  |
| `upper(x)`     | Text in uppercase                                                             |
| `trim(x)`      | Text without spaces at either end                                             |
| `length(x)`    | Characters of text, items of an array, or keys of an object: `length(value.items) > 10` |
| `type(x)`      | `'string'`, `'number'`, `'boolean'`, `'object'`, `'array'` or `'null'`        |

`type()` is handy when a field's type differs between messages: `type(value.id) = 'string'`.

### Messages of different shapes

A topic often carries several kinds of messages (event types, schema versions), so a field one message has may
be missing in another. The filter treats that as normal, not as an error:

- **A missing field matches nothing.** `value.status = 'x'`, `value.total > 3` and `value.name LIKE 'a%'` are all
  false for a message without that field.
- **Negations match it.** `!=`, `NOT LIKE`, `NOT IN`, `NOT CONTAINS`, `NOT BETWEEN` and `IS NULL` are true for
  a missing field. So `value.type != 'order'` means *everything except orders*, including messages with no `type`.
  (This differs from SQL, where comparing with a missing value is always unknown.)
- **Paths that reach many values** (`[*]`, or a name across an array) pass if **any** value passes.
  `value.items[*].qty > 3` means *some item has qty above 3*. Its negation, `NOT value.items[*].qty > 3`, means
  *no item does*.
- **Payloads that aren't JSON** are one text value: `value LIKE 'ERROR%'` works on plain log lines. Binary
  payloads are compared as their hex text.

### Comparing by meaning

Values are compared by what they mean, not only by their JSON type:

| Comparison                         | Result                                    |
| ---------------------------------- | ----------------------------------------- |
| `value.id = '42'` with `"id": 42`  | Matches: text that is a number compares as a number |
| `headers.retries >= 3`             | Header values are text, and still compare as numbers |
| `value.paid = 'true'`              | Matches `"paid": true`                    |
| `value.total > 10` with `"total": "19.90"` | Matches                           |
| Two pieces of text                 | Compared alphabetically, case-sensitive   |
| Objects or arrays                  | Only `=` (equal as JSON)                  |
| Anything else (e.g. text vs object) | Never matches                            |

### Dates

A date in quotes compares with any number as epoch milliseconds. That works for `timestamp` and for payload
fields holding epoch-millis times:

```sql
timestamp >= '2026-10-01'                        -- midnight, local time
timestamp BETWEEN '2026-10-01 08:00' AND '2026-10-01 09:30:15.250'
value.createdAt > '2026-10-01T08:00:00Z'         -- RFC 3339: UTC or with an offset
```

Dates without a zone are **local time**, the same as the table shows.

### Examples

```sql
-- Orders that shipped to VIP customers
value.type = 'order' AND value.status = 'shipped' AND value.customer.tags CONTAINS 'vip'

-- Any line item over 100, for one customer, ignoring email case
value.items[*].price > 100 AND lower(value.customer.email) = 'ada@example.com'

-- Events from a schema version that has no `version` field yet
value.version IS NULL

-- Messages whose id was sent as text instead of a number
type(value.id) = 'string'

-- Retried messages from web or iOS in the last morning
headers.retries > 0 AND headers.x-source IN ('web', 'ios') AND timestamp >= '2026-10-31 06:00'

-- Plain-text logs
value ILIKE '%connection reset%' AND NOT value LIKE 'DEBUG%'
```

### Suggestions

Suggestions appear as you type. **Ctrl+Space** opens them, **↑ / ↓** pick one, **Enter** accepts and **Esc** closes them.
They come from the topic itself: the first time the filter bar gets focus, KUI reads the newest 500 messages,
plus whatever the table and live tail show, and learns:

- **Every field path**, including fields only some messages have. Each suggestion shows the field's types and
  how many sampled messages have it, e.g. `string · 75%`. A field without a percentage is in every message.
- **Fields by name alone.** Type `email` to get `value.customer.email` without knowing where it sits.
- **Operators that fit the field.** Text gets `LIKE` / `CONTAINS`, numbers `BETWEEN` / `>`, arrays `CONTAINS`,
  booleans `= true`.
- **Values that actually occur**, most common first, with how often they appear. For `timestamp`, recent dates.
- **`AND` / `OR` / `)`** once a condition is complete.

Mistakes are underlined as you type, with the reason under the bar, and **Apply** stays disabled until the filter
is valid.

### Searching large topics

A filter doesn't make Kafka do the work: KUI reads messages and tests each one. One page of results stops reading
after **50,000 messages or 5 seconds**, whichever comes first, so the app stays responsive. The line under the
filter bar says how many messages that page read. If the page stopped early, it may have fewer matches than the
page size (or none). **Next page continues the search** from exactly where it stopped, without skipping or
repeating anything.

Pages of results have no overall count, so the footer shows the matches on the page and the page number.

To search faster, narrow the range first: pick a partition, or start **From time** / **From offset**.

---

## How it works

```
                      ┌────────────────────── Rust: src-tauri/src/features/messages/query ──────────────────────┐
 query text ──────────▶ lexer.rs ─▶ tokens ─▶ parser.rs ─▶ Expr (AST) ─▶ evaluate.rs ─▶ match? per Message   │
                      └─────────────────────────────────────────────────────────────────────────────────────────┘
                                    ▲ check_message_query (as you type)          ▲ browse / tail / export
                                    │                                             │
 ┌──────────────── TypeScript: src/features/messages ─────────────────────────────┴───────────┐
 │ query-bar.tsx ─ query-editor.tsx (CodeMirror 6) ─┬─ completion.ts ◀─ catalog.ts ◀─ sampled messages │
 │                                                  └─ lexer.ts (highlighting, completion context)   │
 └────────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Rust is the only parser and evaluator.** The TypeScript side never decides whether a message matches or
whether a query is valid. It only tokenizes leniently for highlighting and suggestions, and asks Rust for
errors. That keeps one definition of the language.

### Files

| File | Role |
| ---- | ---- |
| `src-tauri/src/features/messages/query/mod.rs` | Public API: `Query::parse`, `Query::optional`, `Query::matches`, `QueryError` |
| `…/query/lexer.rs` | Text → tokens, with UTF-16 positions |
| `…/query/parser.rs` | Tokens → `Expr` tree; defines `Root` and `Func` |
| `…/query/evaluate.rs` | `Expr` × `Message` → `bool`; comparison and `LIKE` rules |
| `…/messages/service.rs` | `browse_with` (search loop, `PageReader`), `tail` (filters batches) |
| `…/messages/window.rs` | `resume_after`: the cursor after part of a page |
| `…/messages/commands.rs` | `check_message_query` command |
| `src/features/messages/query/lexer.ts` | Forgiving tokenizer; `ROOTS`, `FUNCTIONS`, `KEYWORDS` |
| `src/features/messages/query/catalog.ts` | Learns fields, types, presence and values from messages |
| `src/features/messages/query/completion.ts` | Context at the caret → suggestions |
| `src/features/messages/query/use-field-catalog.ts` | Builds the catalog lazily, only when suggestions ask |
| `src/features/messages/components/query-editor.tsx` | CodeMirror setup: completion source, linter, highlighting, theme |
| `src/features/messages/components/query-bar.tsx` | The bar: apply, clear, error line, syntax help |

### Lexer (`lexer.rs`)

A hand-written scanner over `char`s. Token kinds: `Ident`, `QuotedIdent` (`"…"`), `Str` (`'…'`), `Num`, and the
punctuation and comparison operators. Keywords stay `Ident`s and are matched case-insensitively by the parser,
so the same word can be a keyword or (after a dot) a field name: `value.in` is a field called `in`.

Details worth knowing:

- **Positions are UTF-16 offsets**, the unit JavaScript strings and CodeMirror use. An error underline lands on
  the right characters even after emoji or accented text.
- **`-` is an identifier character after the first one** (`x-trace-id`), since the language has no arithmetic.
  A `-` before a digit starts a negative number.
- `.` followed by a digit starts a number (`.5`). That's why a field named with digits must be quoted:
  `value."123"`. The completion's `nameSegment()` quotes such names automatically.
- Errors: unclosed quotes, malformed numbers (`12abc`), and unexpected characters, each with a range.

### Grammar and AST (`parser.rs`)

Recursive descent, one function per precedence level:

```text
query     := [WHERE] or EOF
or        := and (OR and)*
and       := not (AND not)*
not       := NOT not | '(' or ')' | predicate
predicate := operand [ cmp operand
                     | [NOT] (LIKE | ILIKE | CONTAINS) operand
                     | [NOT] IN '(' operand (',' operand)* ')'
                     | [NOT] BETWEEN operand AND operand
                     | IS [NOT] NULL ]
operand   := 'text' | number | TRUE | FALSE | NULL
           | function '(' operand ')'
           | root ( '.' name | '[' (integer | '*' | 'name' | "name") ']' )*
root      := key | value | headers | partition | offset | timestamp
```

```rust
enum Expr {
    And(Box<Expr>, Box<Expr>), Or(..), Not(Box<Expr>),
    Compare(Operand, Cmp, Operand),      // = != < <= > >=
    Text(Operand, TextOp, Operand),      // LIKE ILIKE CONTAINS
    In(Operand, Vec<Operand>),
    Between(Operand, Operand, Operand),
    IsNull(Operand),
    Truthy(Operand),                     // a bare operand
}
enum Operand { Literal(Literal), Path { root: Root, segments: Vec<Segment> }, Call(Func, Box<Operand>) }
enum Segment { Field(String), Index(i64), Each }
```

The parser **desugars** wherever it can, so the evaluator stays small:

| Written                 | Becomes                         |
| ----------------------- | ------------------------------- |
| `x NOT LIKE y` (and `NOT IN`, `NOT BETWEEN`, `NOT CONTAINS`) | `Not(Text(x, Like, y))` |
| `x IS NOT NULL`         | `Not(IsNull(x))`                |
| `x = NULL` / `x != NULL` | `IsNull(x)` / `Not(IsNull(x))` |
| `x` alone before `AND`/`OR`/`)`/end | `Truthy(x)`         |

`BETWEEN a AND b` is unambiguous because `BETWEEN` consumes exactly one operand, then requires the `AND`.

Errors are tied to the token where parsing stopped, with messages written for people:
`Unknown field 'status': start with key, value, headers…`, `'offset' is a number and has no fields`,
`Expected an operator: =, !=, <, >, LIKE…`, `Unmatched ')'`, `Unknown function 'size' (use lower, …)`.

### Evaluation (`evaluate.rs`)

`evaluate(&Expr, &Doc) -> bool`. A `Doc` wraps one `Message` and parses its key and value as JSON **at most once,
and only if the query touches them** (`OnceCell`). A query on `headers` or `offset` never parses payloads.

**Operands evaluate to a list of values** (`Vec<Cow<Value>>`), not one value:

- missing field → `[]`
- `value.status` → `["shipped"]`
- `value.items[*].sku` or `value.items.sku` → `["A-1", "B-2"]`
- literals → one value; functions map over the list

`Cow` borrows from the parsed document where possible. Owned values appear only for literals, function results,
headers, and JSON found inside strings.

The list semantics give every rule in [Messages of different shapes](#messages-of-different-shapes) for free:

| Expr | Rule |
| ---- | ---- |
| `Compare(l, op, r)` | true if **any** pair (l, r) satisfies `op`. `[]` has no pairs → false |
| `Compare(l, Ne, r)` | `!(any pair is equal)`, so that `!=` is exactly `NOT =`, and `[]` → true |
| `In(l, items)` | any pair equal |
| `Between(v, lo, hi)` | some `v` is ≥ some `lo` and ≤ some `hi` |
| `IsNull(x)` | every value is `null` (true for `[]`) |
| `Truthy(x)` | some value is truthy |
| `Not(e)` | `!e` |

**Path steps** (`step()`): an object field, an array index (negative counts from the end), `Each` over array
elements or object values, a field name applied to an array (fans out to each element), and a string that holds a
JSON object or array, which is parsed and walked into (`embedded_json`). `headers` is special at the first step:
`headers.name` collects **every** header with that name (Kafka allows duplicates), exactly or else ignoring case.
Header values that look like JSON objects or arrays are parsed too.

**Comparison** (`compare() -> Option<Ordering>`, `None` = can't compare = no match):

1. number vs number: as `i64` when both are integers (exact for offsets and epoch millis), else `f64`
2. text vs text: byte order
3. number vs text: the text as a number, otherwise as a date (`parse_date`) in epoch millis
4. bool vs bool, or vs `'true'`/`'false'`
5. null vs null; object/array vs the same kind: JSON equality only

**Text operators** take the "text" of each value: strings as they are, everything else as compact JSON. A bare
`key`/`value` root uses the **raw payload text** instead, so `value CONTAINS '…'` searches what the producer
sent. `LIKE` is a linear greedy matcher that backtracks to the last `%`, with no regex and no new dependency.

### Searching (`service.rs`)

Paging works with a **cursor**: one position per partition (see the top of `window.rs`). Without a filter,
`browse_with` reads one window per partition and merges them by time (`PageReader::read`, which is unchanged
from before). With a filter it runs a search loop:

```text
cursor := request.cursor (or each partition's start)
loop:
    raw, next := PageReader::read(cursor, 500)        // a raw page in browse order
    for each message in raw:
        scanned += 1; consumed.push(partition, offset)
        if query.matches(message): keep it; stop if the page is full
    page full mid-chunk  → next := resume_after(cursor, consumed)   ── return
    topic ended          → next := None                             ── return
    budget spent / stuck → next := next                             ── return
    cursor := next
```

The subtle case is **stopping in the middle of a raw chunk**. The raw page's own `next` points past all 500
messages, so returning it would skip matches that were read but not used. `window::resume_after` builds the
cursor from the messages actually looked at instead. Each partition moves to just after its last consumed offset
(going forward, `offset + 1`; going backward, `offset`, because the backward cursor is an exclusive upper
bound). Partitions not touched keep their previous position. This is correct because `merge_page` guarantees that
each partition contributes **consecutive** offsets to a page.

Budgets (`SEARCH_SCAN_BUDGET = 50_000` messages, `SEARCH_TIME_BUDGET = 5s`) bound one request. The page reports
`scanned`. A page can come back short or empty with `next` still set, and the UI says so. A "stuck" check (nothing
read and the cursor didn't move) guarantees the loop always ends.

The filter is parsed **before** anything is read, so a typo fails at once with `Invalid query: …`.

The same filter reaches:

- **Live tail** (`tail`): each polled message is tested before it joins a batch.
- **Export** (`export`): it pages through `browse_with`, so a range export is a filtered export. Its existing
  "no progress" guard already handles empty search pages that still advance the cursor.

### API changes

| Type | Change |
| ---- | ------ |
| `BrowseRequest` | `query: Option<String>` (`#[serde(default)]`, so old callers still work) |
| `BrowsePage` | `scanned: Option<u64>`: set only for filtered pages |
| `TailRequest` | `query: Option<String>` |
| new command | `check_message_query(query) -> Option<QueryError>`: pure parsing, reads nothing from Kafka |

`QueryError { message, start, end }` serializes to the UI with UTF-16 offsets.

### Suggestions (TypeScript)

The editor is **CodeMirror 6** (`@codemirror/view`, `state`, `autocomplete`, `lint`, `commands`). It handles the
popup, keyboard navigation, underlines and history. What to suggest is KUI's own logic, because it depends on the
topic's data.

#### Field catalog (`catalog.ts`)

`buildCatalog(messages)` walks every sampled message the way the Rust evaluator would see it: key and value parsed
as JSON when possible, headers as `headers.<name>`, arrays as `[*]`, and JSON inside strings walked into. For each
path it records:

- `present`: how many messages have it (counted once per message, even if it repeats in an array)
- `types`: messages per JSON type. A field can be `number` in some messages and `string` in others.
- `values`: the most common scalar values (up to 30 kept, of 200 tracked), with counts
- `parent`/`segment`, and a `children` index for walking down paths

Limits keep it cheap on odd data: depth 8, 2,000 fields, 200 keys per object, 120-character values, and
payloads up to 512 KB. Paths are written the way a query writes them, quoting names that need it
(`nameSegment`).

Sources are the 500-message sample (`useMessageSample`, fetched on first focus and cached for a minute), the
current page, and the live tail. `useFieldCatalog` returns a **getter** that rebuilds only when a source list
changed *and* suggestions are requested, so a busy live tail costs nothing while the editor is idle.

#### Completion (`completion.ts`)

`complete(text, caret, catalog)` returns `{ from, to, items }`:

1. **Tokenize** the text before the caret with the forgiving `lexer.ts`, where unclosed quotes are fine.
2. **Split off the partial word** touching the caret (an identifier, a number, or an open quote). Its start is
   `from`; `to` extends over the rest of the word after the caret.
3. **Run a state machine** over the remaining tokens. It mirrors the grammar but records *what is expected next*
   instead of building a tree:

   ```
   operand ─field/literal─▶ operator ─= < LIKE CONTAINS─▶ value ─▶ connector ─AND/OR─▶ operand
              │                 ├─NOT─▶ notOp ─LIKE/IN/BETWEEN─▶ …
              │                 ├─IS─▶ is ─NOT─▶ isNot ─NULL─▶ connector
              │                 ├─IN─▶ inOpen ─(─▶ value ⇄ inNext (, or ))
              │                 └─BETWEEN─▶ value ─▶ betweenAnd ─AND─▶ value
              ├─fn(─▶ (argument) ─▶ fnClose ─)─▶ …
              └─( ─▶ group (closed by ) in connector)
   ```

   Along the way it keeps the **left-hand operand** (its canonical path, and any function around it), the
   operator, open groups, and any path being typed. Indexes are normalized to `[*]`, so `value.items[3].` finds
   the catalog entry `value.items[*]`. Anything it can't follow becomes `invalid`, which suggests nothing rather
   than guessing.
4. **Suggest for that state**:

   | State | Suggestions |
   | ----- | ----------- |
   | operand | the six roots, top-level payload fields by presence, **any nested field whose path or last name matches what's typed**, functions, `NOT`, `(` |
   | inside a path (`value.customer.`) | that object's children; for `value.items.`, the elements' children; inside `[`: `*]`, `0]`, `-1]`, `'name']` |
   | operator | chosen by the left side's most common type (`time`, `number`, `string`, `boolean`, `array`, `object`); mixed-type fields get the union |
   | value | the field's real values, most common first, as literals; `type(…)` → type names; `lower(…)` → lowercased values; `timestamp` → recent dates; `CONTAINS` on an array → element values; `LIKE` → a starter `'…%'` pattern |
   | connector | `AND`, `OR`, and `)` when a group is open |

Each suggestion carries its `insert` text, where the caret goes (`IN ()` puts it inside), and `retrigger`, which
reopens suggestions after accepting, so a field leads to its operators and an operator to its values. Objects
insert a trailing `.`, arrays of objects `[*].`, and other fields a space. Inside a path, only the segment
after the dot is replaced, so a user's `[0]` stays as typed.

Ranking happens here (prefix of the path, then prefix of the name, then substring), and CodeMirror's own
filtering is off (`filter: false`). That keeps the order deterministic and tested.

#### Editor (`query-editor.tsx`)

- **Completion source:** calls `complete()` with the catalog getter. Kinds map to CodeMirror types for styling.
- **Linter:** debounced 250 ms. It calls `check_message_query` and turns the `QueryError` range into a
  diagnostic (a wavy underline). It also reports the problem to the bar, which shows it and disables Apply. A
  result is dropped if the text changed while the check ran.
- **Highlighting:** a `ViewPlugin` that marks `lexer.ts` tokens (keywords, roots, functions, strings, numbers).
  A word right after a dot is never colored as a keyword.
- **Single line:** a transaction filter turns pasted newlines into spaces. **Enter** submits, unless the
  suggestion list is open, in which case it accepts the suggestion.
- The editor is created once. Props are read through a ref, and outside value changes (Clear) are dispatched in.

`QueryBar` re-checks the text before applying, because the as-you-type check is debounced, so an invalid
filter never reaches `browse`.

### Tests

| Where | Covers |
| ----- | ------ |
| `query/lexer.rs` | tokens, quotes, UTF-16 positions, errors |
| `query/parser.rs` | precedence, paths, desugaring, error positions and messages |
| `query/evaluate.rs` | paths and wildcards, embedded JSON, by-meaning comparison, missing fields, text operators, `LIKE`, dates |
| `window.rs` | `resume_after` in both directions |
| `integration_tests.rs` (needs Kafka) | search pages hold only matches and resume mid-chunk; invalid queries fail |
| `query/completion.test.ts` | catalog stats; suggestions for each state on a topic with two message shapes |
| `e2e/specs/09-message-query.e2e.ts` | the real app: field → operator → value suggestions, results, error underline |

```sh
bun test src                                            # TypeScript
cd src-tauri && cargo test                              # Rust unit tests
bun run kafka:up && cd src-tauri && cargo test -- --ignored   # with Kafka
bun run test:e2e                                        # the app, in Docker
```

### Extending the language

The language is defined in Rust. The TypeScript lists only mirror names for suggestions and highlighting.

**A function:** add it to `Func` and `Func::ALL` in `parser.rs`, implement it in `call()` in `evaluate.rs`, add a
test, and then add it to `FUNCTIONS` in `lexer.ts` and `FUNCTION_DETAIL` in `completion.ts`. If it changes the
type of its argument, update `lhsTypes()` so operators and values still fit.

**An operator:** parse it in `predicate()`, desugar it if it can be expressed with existing nodes, otherwise add an
`Expr` variant and its rule in `evaluate()`. On the TypeScript side, add it to `KEYWORDS` when it's a word, to the
`operator`/`notOp` handling in `run()`, and to `operatorItems()` for the types it fits.

**A field root:** add it to `Root` and `Root::ALL`, handle it in `root_values()`, and add it to `ROOTS` in
`lexer.ts` and `lhsTypes()`. If it isn't payload data, record it in `buildCatalog()` as a built-in.

Also update the [Using it](#using-it) section and the help in `query-bar.tsx`.

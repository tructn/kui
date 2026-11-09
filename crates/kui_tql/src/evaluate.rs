//! Evaluates a parsed filter against one message.
//!
//! Messages in a topic rarely share one shape, so evaluation is forgiving:
//! - A path can lead to many values (`[*]`, or a name applied across an array,
//!   as in `value.items.sku`); a test passes if *any* of them passes.
//! - A missing field matches nothing: `=`, `<`, `LIKE`… are false for it, while
//!   the negated forms (`!=`, `NOT LIKE`, `NOT IN`) are true.
//! - Text and numbers compare by meaning: `'42' = 42`, and a date string such as
//!   `'2026-10-01'` compares with epoch-millis numbers like `timestamp`.
//! - A string holding JSON (`"payload": "{\"id\":1}"`) can be walked into, at
//!   any depth. Each such string is parsed at most once per message (`Doc::embedded`).

use std::borrow::Cow;
use std::cell::{Cell, OnceCell};
use std::cmp::Ordering;

use elsa::FrozenMap;
use serde_json::{Map, Number, Value};

use super::parser::{Cmp, Expr, Func, Literal, Operand, Root, Segment, TextOp};
use crate::{Payload, Record};

/// One message being tested, with its key and value parsed as JSON on first use.
pub struct Doc<'a, R: ?Sized> {
    record: &'a R,
    key: OnceCell<Value>,
    value: OnceCell<Value>,
    /// JSON parsed out of strings, keyed by the string's address and length. Every
    /// condition that walks into the same string shares one parse, and the result
    /// is borrowed rather than cloned. Append-only, so references stay valid.
    embedded: FrozenMap<(usize, usize), Box<Option<Value>>>,
    /// Value comparisons left for this message. Multi-valued paths compare pairwise, so a
    /// hostile payload with huge arrays would otherwise cost quadratic time.
    budget: Cell<usize>,
    exhausted: Cell<bool>,
}

/// Far above any sensible query (`a[*] = b[*]` over two 1,000-element arrays), far below a hang.
const MAX_COMPARISONS: usize = 1_000_000;

impl<'a, R: Record + ?Sized> Doc<'a, R> {
    pub fn new(record: &'a R) -> Self {
        Doc {
            record,
            key: OnceCell::new(),
            value: OnceCell::new(),
            embedded: FrozenMap::new(),
            budget: Cell::new(MAX_COMPARISONS),
            exhausted: Cell::new(false),
        }
    }

    /// Whether any condition ran out of budget. The message then never matches: a negation
    /// (`NOT`, `!=`) of a condition that was not actually evaluated must not turn it into a match.
    pub fn exhausted(&self) -> bool {
        self.exhausted.get()
    }

    /// Reserves `pairs` comparisons; false (and no test should run) once the message is out.
    fn charge(&self, pairs: usize) -> bool {
        match self.budget.get().checked_sub(pairs) {
            Some(left) => {
                self.budget.set(left);
                true
            }
            None => {
                self.exhausted.set(true);
                false
            }
        }
    }

    /// The JSON object or array written inside `text`, parsed on first use.
    ///
    /// The address is the cache key, so `text` must outlive this `Doc` without moving:
    /// a header in the record, or a string inside a parsed payload or earlier embedded
    /// JSON. Never pass a temporary (see `step_detached`).
    fn embedded(&self, text: &str) -> Option<&Value> {
        if !looks_like_json(text) {
            return None;
        }
        let id = (text.as_ptr() as usize, text.len());
        match self.embedded.get(&id) {
            Some(found) => found.as_ref(),
            None => self.embedded.insert(id, Box::new(embedded_json(text))).as_ref(),
        }
    }

    fn payload(&self, root: Root) -> Option<(Payload<'a>, &OnceCell<Value>)> {
        match root {
            Root::Key => Some((self.record.key()?, &self.key)),
            Root::Value => Some((self.record.value()?, &self.value)),
            _ => None,
        }
    }
}

type Vals<'a> = Vec<Cow<'a, Value>>;

pub fn evaluate<R: Record + ?Sized>(expr: &Expr, doc: &Doc<R>) -> bool {
    match expr {
        Expr::And(a, b) => evaluate(a, doc) && evaluate(b, doc),
        Expr::Or(a, b) => evaluate(a, doc) || evaluate(b, doc),
        Expr::Not(inner) => !evaluate(inner, doc),
        Expr::Compare(left, cmp, right) => {
            let (left, right) = (values(left, doc), values(right, doc));
            match cmp {
                // `!=` is "not equal to any", the negation of `=`, so a missing field passes.
                Cmp::Ne => any_pair(doc, &left, &right, loose_eq).is_some_and(|equal| !equal),
                _ => any_pair(doc, &left, &right, |a, b| compare(a, b).is_some_and(|o| cmp_holds(*cmp, o)))
                    .unwrap_or(false),
            }
        }
        Expr::Text(left, op, right) => {
            let right = values(right, doc);
            let patterns: Vec<Cow<str>> = right.iter().map(|v| text(v)).collect();
            let candidates = texts_or_values(left, doc);
            if !doc.charge(candidates.len().saturating_mul(patterns.len())) {
                return false;
            }
            candidates.iter().any(|candidate| {
                // CONTAINS on an array (also one written as JSON text) tests its elements.
                if matches!(op, TextOp::Contains)
                    && let Some(items) = elements(candidate, doc)
                {
                    return doc.charge(items.len().saturating_mul(right.len()))
                        && right.iter().any(|r| items.iter().any(|item| loose_eq(item, r)));
                }
                let c = candidate.text();
                patterns.iter().any(|p| {
                    doc.charge(text_cost(*op, &c, p))
                        && match op {
                            TextOp::Contains => c.contains(p.as_ref()),
                            TextOp::Like => like(&c, p, false),
                            TextOp::ILike => like(&c, p, true),
                        }
                })
            })
        }
        Expr::In(left, items) => {
            let left = values(left, doc);
            items.iter().any(|item| any_pair(doc, &left, &values(item, doc), loose_eq).unwrap_or(false))
        }
        Expr::Between(value, low, high) => {
            let (low, high) = (values(low, doc), values(high, doc));
            let value = values(value, doc);
            if !doc.charge(value.len().saturating_mul(low.len() + high.len())) {
                return false;
            }
            value.iter().any(|v| {
                low.iter().any(|l| compare(v, l).is_some_and(Ordering::is_ge))
                    && high.iter().any(|h| compare(v, h).is_some_and(Ordering::is_le))
            })
        }
        Expr::IsNull(operand) => values(operand, doc).iter().all(|v| v.is_null()),
        Expr::Truthy(operand) => values(operand, doc).iter().any(|v| truthy(v)),
    }
}

/// What a LIKE/CONTAINS tests: the raw text for a whole key or value
/// (`value CONTAINS 'error'` searches the payload as written), otherwise each value.
enum Candidate<'a> {
    Raw(&'a str),
    Value(Cow<'a, Value>),
}

impl Candidate<'_> {
    fn text(&self) -> Cow<'_, str> {
        match self {
            Candidate::Raw(raw) => Cow::Borrowed(raw),
            Candidate::Value(v) => text(v),
        }
    }
}

fn texts_or_values<'a, R: Record + ?Sized>(operand: &Operand, doc: &'a Doc<R>) -> Vec<Candidate<'a>> {
    if let Operand::Path { root, segments } = operand
        && segments.is_empty()
        && let Some((payload, _)) = doc.payload(*root)
    {
        return vec![Candidate::Raw(payload.text)];
    }
    values(operand, doc).into_iter().map(Candidate::Value).collect()
}

fn values<'a, R: Record + ?Sized>(operand: &Operand, doc: &'a Doc<R>) -> Vals<'a> {
    match operand {
        Operand::Literal(literal) => vec![Cow::Owned(match literal {
            Literal::Str(s) => Value::String(s.clone()),
            Literal::Num(n) => number(*n),
            Literal::Bool(b) => Value::Bool(*b),
            Literal::Null => Value::Null,
        })],
        Operand::Call(func, arg) => values(arg, doc).iter().filter_map(|v| call(*func, v)).map(Cow::Owned).collect(),
        Operand::Path { root, segments } => {
            let mut current = root_values(*root, segments.first(), doc);
            // Headers are looked up by name in `root_values`, so skip that segment here.
            let rest = if *root == Root::Headers && !segments.is_empty() { &segments[1..] } else { &segments[..] };
            for segment in rest {
                let mut next = Vec::new();
                for v in current {
                    match v {
                        Cow::Borrowed(b) => step(doc, b, segment, &mut next),
                        Cow::Owned(o) => step_detached(doc.record, &o, segment, &mut next),
                    }
                }
                current = next;
            }
            current
        }
    }
}

fn root_values<'a, R: Record + ?Sized>(root: Root, first: Option<&Segment>, doc: &'a Doc<R>) -> Vals<'a> {
    let m = doc.record;
    match root {
        Root::Partition => vec![Cow::Owned(Value::from(m.partition()))],
        Root::Offset => vec![Cow::Owned(Value::from(m.offset()))],
        Root::Timestamp => m.timestamp().map(|t| Cow::Owned(Value::from(t))).into_iter().collect(),
        Root::Key | Root::Value => match doc.payload(root) {
            Some((payload, cell)) => vec![Cow::Borrowed(cell.get_or_init(|| parse_payload(payload)))],
            None => Vec::new(),
        },
        Root::Headers => {
            // Header text lives in the record, so JSON in it can be cached and borrowed.
            let header = |value: Option<&'a str>| -> Cow<'a, Value> {
                match value {
                    Some(text) => match doc.embedded(text) {
                        Some(json) => Cow::Borrowed(json),
                        None => Cow::Owned(Value::String(text.to_string())),
                    },
                    None => Cow::Owned(Value::Null),
                }
            };
            match first {
                None => {
                    let map: Map<String, Value> =
                        m.headers().map(|(k, v)| (k.to_string(), header(v).into_owned())).collect();
                    vec![Cow::Owned(Value::Object(map))]
                }
                Some(Segment::Field(name)) => {
                    let exact: Vals = m.headers().filter(|(k, _)| k == name).map(|(_, v)| header(v)).collect();
                    if !exact.is_empty() {
                        return exact;
                    }
                    // Header names are case-insensitive by convention (HTTP habits).
                    m.headers().filter(|(k, _)| k.eq_ignore_ascii_case(name)).map(|(_, v)| header(v)).collect()
                }
                Some(Segment::Each) => m.headers().map(|(_, v)| header(v)).collect(),
                Some(Segment::Index(i)) => usize::try_from(*i)
                    .ok()
                    .and_then(|i| m.headers().nth(i))
                    .map(|(_, v)| header(v))
                    .into_iter()
                    .collect(),
            }
        }
    }
}

/// A payload as JSON when it parses, otherwise as one string.
fn parse_payload(payload: Payload) -> Value {
    if payload.utf8
        && let Ok(json) = serde_json::from_str(payload.text)
    {
        return json;
    }
    Value::String(payload.text.to_string())
}

/// Cheap pre-check, so ordinary text is never handed to the JSON parser.
fn looks_like_json(text: &str) -> bool {
    matches!(text.trim_start().as_bytes().first(), Some(b'{' | b'['))
}

/// An object or array written inside a string, as some producers double-encode.
/// Plain text, numbers and malformed JSON (`"{oops"`) stay strings.
fn embedded_json(text: &str) -> Option<Value> {
    serde_json::from_str(text).ok().filter(|v: &Value| v.is_object() || v.is_array())
}

/// The elements of an array, or of a JSON array written in a string. Only a
/// borrowed string (one stored in the message) may use the cache.
fn elements<'x, 'd: 'x, R: Record + ?Sized>(candidate: &'x Candidate<'d>, doc: &'d Doc<R>) -> Option<&'x Vec<Value>> {
    match candidate {
        Candidate::Value(Cow::Borrowed(Value::String(s))) => doc.embedded(s)?.as_array(),
        Candidate::Value(v) => v.as_array(),
        Candidate::Raw(_) => None,
    }
}

/// `step` for a value computed during evaluation (not stored in the message).
/// It can't use the message's cache, whose keys are addresses, so it gets a
/// short-lived one and copies out what it finds. Rare: such values are scalars
/// or plain header text, with nothing inside.
fn step_detached<'d, R: Record + ?Sized>(record: &R, value: &Value, segment: &Segment, out: &mut Vals<'d>) {
    let scratch = Doc::new(record);
    let mut found = Vec::new();
    step(&scratch, value, segment, &mut found);
    out.extend(found.into_iter().map(|c| Cow::Owned(c.into_owned())));
}

fn step<'d, R: Record + ?Sized>(doc: &'d Doc<R>, value: &'d Value, segment: &Segment, out: &mut Vals<'d>) {
    match (value, segment) {
        (Value::Object(map), Segment::Field(name)) => out.extend(map.get(name).map(Cow::Borrowed)),
        // A name applied to an array looks inside every element: `value.items.sku`.
        (Value::Array(items), Segment::Field(_)) => items.iter().for_each(|item| step(doc, item, segment, out)),
        (Value::Array(items), Segment::Index(i)) => {
            let at = if *i < 0 { items.len().checked_sub(i.unsigned_abs() as usize) } else { Some(*i as usize) };
            out.extend(at.and_then(|at| items.get(at)).map(Cow::Borrowed));
        }
        (Value::Array(items), Segment::Each) => out.extend(items.iter().map(Cow::Borrowed)),
        (Value::Object(map), Segment::Each) => out.extend(map.values().map(Cow::Borrowed)),
        // JSON written in a string: walk into it (parsed once, then borrowed).
        (Value::String(s), _) => {
            if let Some(inner) = doc.embedded(s) {
                step(doc, inner, segment, out);
            }
        }
        _ => {}
    }
}

fn call(func: Func, value: &Value) -> Option<Value> {
    Some(match func {
        Func::Lower => Value::String(text(value).to_lowercase()),
        Func::Upper => Value::String(text(value).to_uppercase()),
        Func::Trim => Value::String(text(value).trim().to_string()),
        Func::Length => Value::from(match value {
            Value::String(s) => s.chars().count(),
            Value::Array(items) => items.len(),
            Value::Object(map) => map.len(),
            _ => return None,
        }),
        Func::Type => Value::String(type_name(value).to_string()),
    })
}

pub fn type_name(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "boolean",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
    }
}

fn number(n: f64) -> Value {
    if n.fract() == 0.0 && n.abs() < 9e15 {
        Value::from(n as i64)
    } else {
        Number::from_f64(n).map(Value::Number).unwrap_or(Value::Null)
    }
}

/// How a value reads as text: strings as-is, everything else as JSON.
fn text(value: &Value) -> Cow<'_, str> {
    match value {
        Value::String(s) => Cow::Borrowed(s),
        other => Cow::Owned(other.to_string()),
    }
}

fn truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64() != Some(0.0),
        Value::String(s) => !s.is_empty() && !s.eq_ignore_ascii_case("false"),
        Value::Array(_) | Value::Object(_) => true,
    }
}

/// What testing `text` against `pattern` costs, in comparisons. A step is far cheaper than a
/// value comparison, hence the 1/16. LIKE can backtrack up to text x pattern steps and always
/// copies and parses the whole pattern, even for empty text. CONTAINS is a linear search.
fn text_cost(op: TextOp, text: &str, pattern: &str) -> usize {
    const STEPS_PER_COMPARISON: usize = 16;
    let linear = text.len().saturating_add(pattern.len());
    let steps = match op {
        TextOp::Contains => linear,
        TextOp::Like | TextOp::ILike => text.len().saturating_mul(pattern.len()).saturating_add(linear),
    };
    (steps / STEPS_PER_COMPARISON).saturating_add(1)
}

/// Whether any pair passes `test`, or `None` when the message's comparison budget can't cover it.
fn any_pair<R: Record + ?Sized>(
    doc: &Doc<R>,
    left: &Vals,
    right: &Vals,
    test: impl Fn(&Value, &Value) -> bool,
) -> Option<bool> {
    doc.charge(left.len().saturating_mul(right.len())).then(|| left.iter().any(|l| right.iter().any(|r| test(l, r))))
}

fn cmp_holds(cmp: Cmp, order: Ordering) -> bool {
    match cmp {
        Cmp::Eq => order.is_eq(),
        Cmp::Ne => order.is_ne(),
        Cmp::Lt => order.is_lt(),
        Cmp::Le => order.is_le(),
        Cmp::Gt => order.is_gt(),
        Cmp::Ge => order.is_ge(),
    }
}

fn loose_eq(a: &Value, b: &Value) -> bool {
    compare(a, b).is_some_and(Ordering::is_eq)
}

/// Orders two values by meaning, or `None` when they can't be compared.
fn compare(a: &Value, b: &Value) -> Option<Ordering> {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => compare_numbers(x, y),
        (Value::String(x), Value::String(y)) => Some(x.cmp(y)),
        (Value::Bool(x), Value::Bool(y)) => Some(x.cmp(y)),
        (Value::Null, Value::Null) => Some(Ordering::Equal),
        (Value::Number(n), Value::String(s)) => compare_number_text(n, s),
        (Value::String(s), Value::Number(n)) => compare_number_text(n, s).map(Ordering::reverse),
        (Value::Bool(b), Value::String(s)) => parse_bool(s).map(|s| b.cmp(&s)),
        (Value::String(s), Value::Bool(b)) => parse_bool(s).map(|s| s.cmp(b)),
        (Value::Array(_), Value::Array(_)) | (Value::Object(_), Value::Object(_)) => {
            (a == b).then_some(Ordering::Equal)
        }
        _ => None,
    }
}

fn compare_numbers(x: &Number, y: &Number) -> Option<Ordering> {
    match (x.as_i64(), y.as_i64()) {
        (Some(x), Some(y)) => Some(x.cmp(&y)),
        _ => x.as_f64()?.partial_cmp(&y.as_f64()?),
    }
}

/// A number against text: the text as a number, or as a date in epoch millis.
fn compare_number_text(n: &Number, s: &str) -> Option<Ordering> {
    let n = n.as_f64()?;
    let other = s.trim().parse::<f64>().ok().or_else(|| parse_date(s).map(|ms| ms as f64))?;
    n.partial_cmp(&other)
}

fn parse_bool(s: &str) -> Option<bool> {
    match s.trim().to_ascii_lowercase().as_str() {
        "true" => Some(true),
        "false" => Some(false),
        _ => None,
    }
}

/// RFC 3339 (`2026-10-01T08:00:00Z`), or a local `2026-10-01[ 08:00[:00[.123]]]`.
pub fn parse_date(s: &str) -> Option<i64> {
    use chrono::{DateTime, Local, NaiveDate, NaiveDateTime, TimeZone};
    let s = s.trim();
    if let Ok(t) = DateTime::parse_from_rfc3339(s) {
        return Some(t.timestamp_millis());
    }
    let naive = ["%Y-%m-%d %H:%M:%S%.f", "%Y-%m-%dT%H:%M:%S%.f", "%Y-%m-%d %H:%M", "%Y-%m-%dT%H:%M"]
        .iter()
        .find_map(|f| NaiveDateTime::parse_from_str(s, f).ok())
        .or_else(|| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok().and_then(|d| d.and_hms_opt(0, 0, 0)))?;
    Local.from_local_datetime(&naive).earliest().map(|t| t.timestamp_millis())
}

/// SQL LIKE: `%` is any run of characters, `_` one character, `\` escapes either.
fn like(text: &str, pattern: &str, ignore_case: bool) -> bool {
    let fold = |s: &str| if ignore_case { s.to_lowercase() } else { s.to_string() };
    let text: Vec<char> = fold(text).chars().collect();
    let pattern: Vec<char> = fold(pattern).chars().collect();

    enum P {
        Any,
        One,
        Char(char),
    }
    let mut parts = Vec::with_capacity(pattern.len());
    let mut i = 0;
    while i < pattern.len() {
        parts.push(match pattern[i] {
            '\\' if i + 1 < pattern.len() => {
                i += 1;
                P::Char(pattern[i])
            }
            '%' => P::Any,
            '_' => P::One,
            c => P::Char(c),
        });
        i += 1;
    }

    // Greedy match with backtracking to the last `%`: linear for typical patterns.
    let (mut t, mut p) = (0, 0);
    let mut star: Option<(usize, usize)> = None;
    while t < text.len() {
        match parts.get(p) {
            Some(P::Any) => {
                star = Some((p, t));
                p += 1;
            }
            Some(P::One) => {
                t += 1;
                p += 1;
            }
            Some(P::Char(c)) if *c == text[t] => {
                t += 1;
                p += 1;
            }
            _ => match star {
                Some((sp, st)) => {
                    p = sp + 1;
                    t = st + 1;
                    star = Some((sp, st + 1));
                }
                None => return false,
            },
        }
    }
    parts[p..].iter().all(|part| matches!(part, P::Any))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Query;

    struct Message {
        key: Option<String>,
        value: String,
        headers: Vec<(String, String)>,
    }

    impl Record for Message {
        fn partition(&self) -> i32 {
            2
        }
        fn offset(&self) -> i64 {
            40
        }
        fn timestamp(&self) -> Option<i64> {
            Some(1_790_000_000_000)
        }
        fn key(&self) -> Option<Payload<'_>> {
            self.key.as_deref().map(|text| Payload { text, utf8: true })
        }
        fn value(&self) -> Option<Payload<'_>> {
            Some(Payload { text: &self.value, utf8: true })
        }
        fn headers(&self) -> impl Iterator<Item = (&str, Option<&str>)> {
            self.headers.iter().map(|(k, v)| (k.as_str(), Some(v.as_str())))
        }
    }

    fn message(key: Option<&str>, value: &str, headers: &[(&str, &str)]) -> Message {
        Message {
            key: key.map(str::to_string),
            value: value.to_string(),
            headers: headers.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect(),
        }
    }

    fn matches(query: &str, m: &Message) -> bool {
        Query::parse(query).unwrap_or_else(|e| panic!("{query}: {e:?}")).matches(m)
    }

    const ORDER: &str = r#"{"id": 7, "status": "shipped", "total": "19.90", "paid": true,
        "customer": {"name": "Ada Lovelace", "tags": ["vip", "eu"]},
        "items": [{"sku": "A-1", "qty": 2}, {"sku": "B-2", "qty": 5}],
        "meta": "{\"source\": \"web\"}"}"#;

    #[test]
    fn walks_json_paths() {
        let m = message(Some("order-7"), ORDER, &[]);
        assert!(matches("value.status = 'shipped'", &m));
        assert!(matches("value.customer.name LIKE 'Ada%'", &m));
        assert!(matches("value.items[1].qty = 5", &m));
        assert!(matches("value.items[-1].sku = 'B-2'", &m));
        assert!(matches("value.items[*].sku = 'A-1'", &m));
        // A name across an array looks in every element.
        assert!(matches("value.items.qty > 4", &m));
        assert!(!matches("value.items.qty > 5", &m));
        assert!(matches("value.meta.source = 'web'", &m));
        assert!(matches("value.paid AND key = 'order-7'", &m));
    }

    #[test]
    fn compares_by_meaning() {
        let m = message(None, ORDER, &[("retries", "3"), ("x-trace-id", "abc")]);
        assert!(matches("value.total > 10", &m));
        assert!(matches("value.id = '7'", &m));
        assert!(matches("headers.retries >= 3", &m));
        assert!(matches("headers.X-Trace-Id = 'abc'", &m));
        assert!(matches("value.paid = 'true'", &m));
        assert!(matches("offset BETWEEN 10 AND 40 AND partition IN (1, 2)", &m));
        assert!(matches("timestamp > '2026-01-01' AND timestamp < '2027-01-01T00:00:00Z'", &m));
    }

    #[test]
    fn missing_fields_match_only_negations() {
        let m = message(None, r#"{"kind": "ping"}"#, &[]);
        assert!(!matches("value.status = 'shipped'", &m));
        assert!(matches("value.status != 'shipped'", &m));
        assert!(matches("value.status NOT IN ('a')", &m));
        assert!(matches("value.status IS NULL", &m));
        assert!(matches("value.status = null", &m));
        assert!(!matches("value.kind IS NULL", &m));
        assert!(!matches("key IS NOT NULL", &m));
        assert!(!matches("value.status < 3", &m));
    }

    #[test]
    fn text_operators() {
        let m = message(None, ORDER, &[]);
        // The whole value is searched as written.
        assert!(matches("value CONTAINS '\"status\": \"shipped\"'", &m));
        assert!(matches("value.customer.tags CONTAINS 'vip'", &m));
        assert!(!matches("value.customer.tags CONTAINS 'vi'", &m));
        assert!(matches("value.customer.name CONTAINS 'Love'", &m));
        assert!(matches("value.customer.name ILIKE '%lovelace'", &m));
        assert!(!matches("value.customer.name LIKE '%lovelace'", &m));
        assert!(matches("lower(value.customer.name) = 'ada lovelace'", &m));
        assert!(matches("length(value.items) = 2 AND type(value.customer) = 'object'", &m));
    }

    #[test]
    fn plain_text_payloads() {
        let m = message(Some("42"), "ERROR disk full", &[]);
        assert!(matches("value LIKE 'ERROR%'", &m));
        assert!(matches("key = 42", &m));
        assert!(matches("type(value) = 'string'", &m));
        assert!(!matches("value.anything = 1", &m));
    }

    /// An analytics event whose `properties` is JSON written as a string, with
    /// another JSON string (`context`) inside it, and arrays in both.
    fn analytics_event() -> String {
        let context = r#"{"ip": "10.0.0.7", "geo": {"cc": "VN", "city": "Hà Nội"}, "flags": [1, 2, 3]}"#;
        let properties = serde_json::json!({
            "page": {"url": "https://shop.example/cart?step=2", "title": "Say \"hi\""},
            "cart": [{"sku": "A-1", "qty": 2, "opts": {"gift": true}}, {"sku": "B-2", "qty": 7}],
            "tags": "[\"vip\", \"beta\"]",
            "context": context,
            "pretty": "\n  {\n    \"x\": 1\n  }",
            "note": "{not json at all",
            "label": "plain text",
        });
        serde_json::json!({"event": "checkout", "properties": properties.to_string()}).to_string()
    }

    #[test]
    fn walks_json_written_in_strings() {
        let m = message(None, &analytics_event(), &[("ctx", r#"{"tenant": {"id": 9}}"#)]);
        assert!(matches("value.properties.page.title = 'Say \"hi\"'", &m));
        assert!(matches("value.properties.page.url LIKE '%step=2'", &m));
        assert!(matches("value.properties.cart[*].qty > 5 AND value.properties.cart[-1].sku = 'B-2'", &m));
        assert!(matches("value.properties.cart.opts.gift", &m));
        // Two levels deep: a string inside a string.
        assert!(matches("value.properties.context.geo.cc = 'VN'", &m));
        assert!(matches("value.properties.context.geo.city = 'Hà Nội'", &m));
        assert!(matches("value.properties.context.flags[*] = 3", &m));
        assert!(matches("value.properties.pretty.x = 1", &m));
        assert!(matches("value.properties.missing IS NULL", &m));
        assert!(matches("headers.ctx.tenant.id = 9", &m));
        // The string itself is still text.
        assert!(matches("value.properties CONTAINS 'shop.example'", &m));
        assert!(matches("type(value.properties) = 'string'", &m));
        // Plain or malformed text stays a string, with nothing inside.
        assert!(matches("value.properties.label = 'plain text'", &m));
        assert!(matches("value.properties.note = '{not json at all'", &m));
        assert!(matches("value.properties.note.x IS NULL", &m));
    }

    #[test]
    fn contains_tests_elements_of_arrays_written_in_strings() {
        let m = message(None, &analytics_event(), &[("tags", r#"["a", "bc"]"#)]);
        assert!(matches("value.properties.tags CONTAINS 'vip'", &m));
        // Elements, like a real array, not a substring of the text.
        assert!(!matches("value.properties.tags CONTAINS 'vi'", &m));
        assert!(matches("value.properties.context.flags CONTAINS 2", &m));
        assert!(matches("headers.tags CONTAINS 'bc' AND NOT headers.tags CONTAINS 'b'", &m));
    }

    #[test]
    fn whole_payload_written_as_a_json_string() {
        let doubled = serde_json::to_string(&analytics_event()).unwrap();
        let m = message(None, &doubled, &[]);
        assert!(matches("value.event = 'checkout'", &m));
        assert!(matches("value.properties.context.geo.cc = 'VN'", &m));
    }

    #[test]
    fn parses_each_json_string_once() {
        let m = message(None, &analytics_event(), &[]);
        let query = Query::parse(
            "value.properties.cart[*].qty > 1 AND value.properties.page.url IS NOT NULL \
             AND value.properties.context.geo.cc = 'VN' AND value.properties.context.ip LIKE '10.%' \
             AND value.properties.label != 'x' AND value.properties.note.x IS NULL",
        )
        .unwrap();
        let doc = Doc::new(&m);
        assert!(evaluate(&query.expr, &doc));
        // `properties`, `context` and the malformed `note`: one cache entry each,
        // however many conditions read them. Plain `label` is never parsed.
        assert_eq!(doc.embedded.len(), 3);
    }

    #[test]
    fn hostile_chains_and_nesting_never_reach_evaluation() {
        let m = message(None, r#"{"a": 1}"#, &[]);
        assert!(Query::parse(&"(".repeat(10_000)).is_err());
        assert!(Query::parse(&vec!["value.a"; 100_000].join(" AND ")).is_err());
        let longest = vec!["value.a"; 501].join(" AND ");
        assert!(Query::parse(&longest).unwrap().matches(&m));
    }

    #[test]
    fn pairwise_comparison_cost_is_bounded_per_message() {
        let evens: Vec<u32> = (0..50_000).map(|n| n * 2).collect();
        let odds: Vec<u32> = (0..50_000).map(|n| n * 2 + 1).collect();
        let hostile = serde_json::json!({"a": evens, "b": odds}).to_string();
        let m = message(None, &hostile, &[]);
        let started = std::time::Instant::now();
        for query in [
            "value.a[*] = value.b[*]",
            "value.a[*] != value.b[*]",
            "value.a[*] < value.b[*]",
            "value.a[*] IN (value.b[*])",
            "value.a[*] BETWEEN value.b[*] AND value.b[*]",
            "value.a[*] CONTAINS value.b[*]",
            "value.a CONTAINS value.b[*]",
            "value.a[*] LIKE value.b[*]",
        ] {
            assert!(!matches(query, &m), "{query}");
        }
        assert!(started.elapsed().as_secs() < 5, "{:?}", started.elapsed());
    }

    #[test]
    fn exhausting_the_budget_fails_closed_through_negations() {
        let evens: Vec<u32> = (0..50_000).map(|n| n * 2).collect();
        let odds: Vec<u32> = (0..50_000).map(|n| n * 2 + 1).collect();
        let m = message(None, &serde_json::json!({"a": evens, "b": odds, "ok": 1}).to_string(), &[]);
        let started = std::time::Instant::now();
        for query in [
            "NOT (value.a[*] = value.b[*])",
            "NOT NOT NOT (value.a[*] = value.b[*])",
            "value.a[*] != value.b[*]",
            "value.a[*] NOT IN (value.b[*])",
            "value.a[*] NOT LIKE value.b[*]",
            "value.ok = 1 AND NOT (value.a[*] = value.b[*])",
            "NOT (value.a[*] = value.b[*]) OR value.ok = 1",
            "NOT (value.a[*] = value.b[*] AND value.ok = 2)",
            "NOT (value.a[*] = value.b[*] OR value.ok = 2)",
        ] {
            assert!(!matches(query, &m), "{query}");
        }
        // Short-circuit: the exhausted branch is never evaluated, so it cannot poison the result.
        assert!(matches("value.ok = 1 OR NOT (value.a[*] = value.b[*])", &m));
        assert!(started.elapsed().as_secs() < 5, "{:?}", started.elapsed());
    }

    #[test]
    fn text_matching_cost_is_charged_to_the_budget() {
        let pattern = "%a".repeat(1_500) + "b";
        let text = "a".repeat(100_000);
        let started = std::time::Instant::now();

        let raw = message(None, &text, &[]);
        assert!(!matches(&format!("NOT (value LIKE '{pattern}')"), &raw));
        assert!(!matches(&format!("NOT (value ILIKE '{pattern}')"), &raw));

        let from_path = message(None, &serde_json::json!({"t": text, "p": pattern}).to_string(), &[]);
        assert!(!matches("NOT (value.t LIKE value.p)", &from_path));
        // CONTAINS is a linear search, so it is priced linearly and still gets evaluated.
        assert!(matches("NOT (value.t CONTAINS value.p)", &from_path));
        assert!(started.elapsed().as_secs() < 5, "{:?}", started.elapsed());
    }

    #[test]
    fn a_huge_pattern_is_charged_even_against_empty_text() {
        let doc = serde_json::json!({"a": vec![""; 2_000], "p": "%a".repeat(500_000)});
        let m = message(None, &doc.to_string(), &[]);
        let started = std::time::Instant::now();
        assert!(!matches("NOT (value.a[*] LIKE value.p)", &m));
        assert!(!matches("NOT (value.a[*] ILIKE value.p)", &m));
        assert!(started.elapsed().as_secs() < 2, "{:?}", started.elapsed());
    }

    #[test]
    fn contains_is_priced_as_the_linear_search_it_is() {
        let m = message(None, &format!("{}failed", "x".repeat(1_000_000)), &[]);
        assert!(matches("value CONTAINS 'qqqqq' OR value CONTAINS 'wwwww' OR value CONTAINS 'failed'", &m));
        assert!(matches("value CONTAINS 'failed' AND value CONTAINS 'xxxxx' AND value CONTAINS 'xfail'", &m));
    }

    #[test]
    fn ordinary_text_matching_on_large_messages_is_unchanged() {
        let big = message(None, &format!("{}error", "x".repeat(1_000_000)), &[]);
        assert!(matches("value CONTAINS 'error'", &big));
        assert!(matches("value LIKE '%error'", &big));
        assert!(matches("value ILIKE '%ERROR%'", &big));
        assert!(!matches("NOT (value LIKE '%error')", &big));
    }

    #[test]
    fn modest_multi_valued_comparisons_are_unchanged() {
        let ids: Vec<u32> = (0..500).collect();
        let m = message(None, &serde_json::json!({"a": ids, "b": ids}).to_string(), &[]);
        assert!(matches("value.a[*] = value.b[*]", &m));
        assert!(!matches("value.a[*] != value.b[*]", &m));
        assert!(matches("value.a[*] IN (value.b[*])", &m));
    }

    #[test]
    fn like_patterns() {
        assert!(like("abc", "a%", false));
        assert!(like("abc", "%b%", false));
        assert!(like("abc", "a_c", false));
        assert!(!like("abc", "a_", false));
        assert!(like("100%", "100\\%", false));
        assert!(!like("1000", "100\\%", false));
        assert!(like("aXbXc", "a%b%c", false));
        assert!(like("", "%", false));
    }

    #[test]
    fn dates() {
        assert_eq!(parse_date("2026-10-01T00:00:00Z"), Some(1_790_812_800_000));
        assert!(parse_date("2026-10-01").is_some());
        assert!(parse_date("2026-10-01 08:30").is_some());
        assert_eq!(parse_date("yesterday"), None);
    }
}

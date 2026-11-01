//! Evaluates a parsed filter against one message.
//!
//! Messages in a topic rarely share one shape, so evaluation is forgiving:
//! - A path can lead to many values (`[*]`, or a name applied across an array,
//!   as in `value.items.sku`); a test passes if *any* of them passes.
//! - A missing field matches nothing: `=`, `<`, `LIKE`… are false for it, while
//!   the negated forms (`!=`, `NOT LIKE`, `NOT IN`) are true.
//! - Text and numbers compare by meaning: `'42' = 42`, and a date string such as
//!   `'2026-10-01'` compares with epoch-millis numbers like `timestamp`.
//! - A string holding JSON (`"payload": "{\"id\":1}"`) can be walked into.

use std::borrow::Cow;
use std::cell::OnceCell;
use std::cmp::Ordering;

use serde_json::{Map, Number, Value};

use super::parser::{Cmp, Expr, Func, Literal, Operand, Root, Segment, TextOp};
use crate::features::messages::model::{Message, Payload};

/// One message being tested, with its key and value parsed as JSON on first use.
pub struct Doc<'a> {
    message: &'a Message,
    key: OnceCell<Value>,
    value: OnceCell<Value>,
}

impl<'a> Doc<'a> {
    pub fn new(message: &'a Message) -> Self {
        Doc { message, key: OnceCell::new(), value: OnceCell::new() }
    }

    fn payload(&self, root: Root) -> Option<(&'a Payload, &OnceCell<Value>)> {
        match root {
            Root::Key => Some((self.message.key.as_ref()?, &self.key)),
            Root::Value => Some((self.message.value.as_ref()?, &self.value)),
            _ => None,
        }
    }
}

type Vals<'a> = Vec<Cow<'a, Value>>;

pub fn evaluate(expr: &Expr, doc: &Doc) -> bool {
    match expr {
        Expr::And(a, b) => evaluate(a, doc) && evaluate(b, doc),
        Expr::Or(a, b) => evaluate(a, doc) || evaluate(b, doc),
        Expr::Not(inner) => !evaluate(inner, doc),
        Expr::Compare(left, cmp, right) => {
            let (left, right) = (values(left, doc), values(right, doc));
            match cmp {
                // `!=` is "not equal to any", the negation of `=`, so a missing field passes.
                Cmp::Ne => !any_pair(&left, &right, loose_eq),
                _ => any_pair(&left, &right, |a, b| compare(a, b).is_some_and(|o| cmp_holds(*cmp, o))),
            }
        }
        Expr::Text(left, op, right) => {
            let patterns: Vec<String> = values(right, doc).iter().map(|v| text(v).into_owned()).collect();
            texts_or_values(left, doc).iter().any(|candidate| match (op, candidate) {
                (TextOp::Contains, Candidate::Value(v)) if v.is_array() => {
                    let items = v.as_array().into_iter().flatten();
                    values(right, doc).iter().any(|r| items.clone().any(|item| loose_eq(item, r)))
                }
                (TextOp::Contains, c) => patterns.iter().any(|p| c.text().contains(p.as_str())),
                (TextOp::Like, c) => patterns.iter().any(|p| like(&c.text(), p, false)),
                (TextOp::ILike, c) => patterns.iter().any(|p| like(&c.text(), p, true)),
            })
        }
        Expr::In(left, items) => {
            let left = values(left, doc);
            items.iter().any(|item| any_pair(&left, &values(item, doc), loose_eq))
        }
        Expr::Between(value, low, high) => {
            let (low, high) = (values(low, doc), values(high, doc));
            values(value, doc).iter().any(|v| {
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

fn texts_or_values<'a>(operand: &Operand, doc: &'a Doc) -> Vec<Candidate<'a>> {
    if let Operand::Path { root, segments } = operand
        && segments.is_empty()
        && let Some((payload, _)) = doc.payload(*root)
    {
        return vec![Candidate::Raw(&payload.text)];
    }
    values(operand, doc).into_iter().map(Candidate::Value).collect()
}

fn values<'a>(operand: &Operand, doc: &'a Doc) -> Vals<'a> {
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
                        Cow::Borrowed(b) => step(b, segment, &mut next),
                        Cow::Owned(o) => {
                            let mut owned = Vec::new();
                            step(&o, segment, &mut owned);
                            next.extend(owned.into_iter().map(|c| Cow::Owned(c.into_owned())));
                        }
                    }
                }
                current = next;
            }
            current
        }
    }
}

fn root_values<'a>(root: Root, first: Option<&Segment>, doc: &'a Doc) -> Vals<'a> {
    let m = doc.message;
    match root {
        Root::Partition => vec![Cow::Owned(Value::from(m.partition))],
        Root::Offset => vec![Cow::Owned(Value::from(m.offset))],
        Root::Timestamp => m.timestamp.map(|t| Cow::Owned(Value::from(t))).into_iter().collect(),
        Root::Key | Root::Value => match doc.payload(root) {
            Some((payload, cell)) => vec![Cow::Borrowed(cell.get_or_init(|| parse_payload(payload)))],
            None => Vec::new(),
        },
        Root::Headers => {
            let header = |value: &Option<String>| match value {
                Some(text) => embedded_json(text).unwrap_or_else(|| Value::String(text.clone())),
                None => Value::Null,
            };
            match first {
                None => {
                    let map: Map<String, Value> = m.headers.iter().map(|h| (h.key.clone(), header(&h.value))).collect();
                    vec![Cow::Owned(Value::Object(map))]
                }
                Some(Segment::Field(name)) => {
                    let exact: Vals =
                        m.headers.iter().filter(|h| h.key == *name).map(|h| Cow::Owned(header(&h.value))).collect();
                    if !exact.is_empty() {
                        return exact;
                    }
                    // Header names are case-insensitive by convention (HTTP habits).
                    m.headers
                        .iter()
                        .filter(|h| h.key.eq_ignore_ascii_case(name))
                        .map(|h| Cow::Owned(header(&h.value)))
                        .collect()
                }
                Some(Segment::Each) => m.headers.iter().map(|h| Cow::Owned(header(&h.value))).collect(),
                Some(Segment::Index(i)) => usize::try_from(*i)
                    .ok()
                    .and_then(|i| m.headers.get(i))
                    .map(|h| Cow::Owned(header(&h.value)))
                    .into_iter()
                    .collect(),
            }
        }
    }
}

/// A payload as JSON when it parses, otherwise as one string.
fn parse_payload(payload: &Payload) -> Value {
    if payload.encoding == "utf8"
        && let Ok(json) = serde_json::from_str(&payload.text)
    {
        return json;
    }
    Value::String(payload.text.clone())
}

/// An object or array written inside a string, as some producers double-encode.
fn embedded_json(text: &str) -> Option<Value> {
    let trimmed = text.trim_start();
    if !(trimmed.starts_with('{') || trimmed.starts_with('[')) {
        return None;
    }
    serde_json::from_str(text).ok().filter(|v: &Value| v.is_object() || v.is_array())
}

fn step<'a>(value: &'a Value, segment: &Segment, out: &mut Vals<'a>) {
    match (value, segment) {
        (Value::Object(map), Segment::Field(name)) => out.extend(map.get(name).map(Cow::Borrowed)),
        // A name applied to an array looks inside every element: `value.items.sku`.
        (Value::Array(items), Segment::Field(_)) => items.iter().for_each(|item| step(item, segment, out)),
        (Value::Array(items), Segment::Index(i)) => {
            let at = if *i < 0 { items.len().checked_sub(i.unsigned_abs() as usize) } else { Some(*i as usize) };
            out.extend(at.and_then(|at| items.get(at)).map(Cow::Borrowed));
        }
        (Value::Array(items), Segment::Each) => out.extend(items.iter().map(Cow::Borrowed)),
        (Value::Object(map), Segment::Each) => out.extend(map.values().map(Cow::Borrowed)),
        (Value::String(s), _) => {
            if let Some(inner) = embedded_json(s) {
                let mut found = Vec::new();
                step(&inner, segment, &mut found);
                out.extend(found.into_iter().map(|c| Cow::Owned(c.into_owned())));
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

fn any_pair(left: &Vals, right: &Vals, test: impl Fn(&Value, &Value) -> bool) -> bool {
    left.iter().any(|l| right.iter().any(|r| test(l, r)))
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
    use super::super::Query;
    use super::*;
    use crate::features::messages::codec::decode;
    use crate::features::messages::model::MessageHeader;

    fn message(key: Option<&str>, value: &str, headers: &[(&str, &str)]) -> Message {
        Message {
            partition: 2,
            offset: 40,
            timestamp: Some(1_790_000_000_000),
            key: key.map(|k| decode(k.as_bytes())),
            value: Some(decode(value.as_bytes())),
            headers: headers
                .iter()
                .map(|(k, v)| MessageHeader { key: k.to_string(), value: Some(v.to_string()) })
                .collect(),
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

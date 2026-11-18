use serde::{Deserialize, Serialize};

/// What the request body is made of. A new way to build it is a new variant here, a case in
/// `body::render` and one in `body::validate`.
#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum Body {
    /// The message described as JSON.
    #[default]
    Envelope,
    /// Free text with placeholders (see `template.rs`).
    Template { text: String },
    /// A new JSON object built from the message field by field (see `mapping.rs`).
    Mapping { fields: Vec<FieldMapping> },
}

/// One field of the object a `Body::Mapping` builds: read `source`, tidy it with `transform`,
/// and store it at `target`.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldMapping {
    /// Where it goes, as a dotted path: `customer.name`, `items.0.sku`. A number is an array index.
    pub target: String,
    pub source: Source,
    #[serde(default)]
    pub transform: Option<Transform>,
    /// Used when the source is missing or null.
    #[serde(default)]
    pub default: Option<serde_json::Value>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum Source {
    /// A field of the message: `value.order.id`, `headers.x-source`, `key`, `topic`, ...
    Field { path: String },
    /// The same value every time.
    Fixed { value: serde_json::Value },
    /// Text with placeholders, always producing a string.
    Template { text: String },
    /// The list at `path` with every item rebuilt by `fields`, which read the item as `item`.
    Each { path: String, fields: Vec<FieldMapping> },
}

#[derive(Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub enum Transform {
    Trim,
    Upper,
    Lower,
    ToNumber,
    ToString,
    ToBoolean,
    /// Epoch milliseconds to an ISO 8601 date-time.
    EpochToIso,
    /// How many items a list has.
    Count,
    /// A list as one text, items separated by ", ".
    Join,
    First,
    Last,
}

/// What a body would be for a sample message.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BodyPreview {
    /// The first request's body, indented when it is JSON; `None` when no request would be sent.
    pub first: Option<String>,
    /// How many requests the message makes: one, or one per item when split.
    pub requests: usize,
}

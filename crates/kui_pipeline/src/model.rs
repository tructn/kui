use std::fmt;

use serde::{Deserialize, Serialize};

/// What a pipeline does, independent of where it runs: for each new message on `topic` that
/// matches `query`, run every route. The app adds an id, a cluster and an on/off switch.
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Pipeline {
    pub name: String,
    pub topic: String,
    /// MQL filter for every route; blank fires on every message.
    #[serde(default)]
    pub query: Option<String>,
    /// Requests beyond this many a minute, across all routes, are dropped, so a busy topic can't
    /// flood the targets.
    #[serde(default = "default_max_per_minute")]
    pub max_per_minute: u32,
    pub routes: Vec<Route>,
}

pub const DEFAULT_MAX_PER_MINUTE: u32 = 60;
pub const MAX_PER_MINUTE: u32 = 600;

pub fn default_max_per_minute() -> u32 {
    DEFAULT_MAX_PER_MINUTE
}

/// One branch of a pipeline: messages that also match `query` are shaped and sent by `action`.
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Route {
    /// Names the route in the editor's graph; unique within the pipeline.
    pub id: String,
    /// MQL filter for this route only.
    #[serde(default)]
    pub query: Option<String>,
    /// The path of a list in the message, such as `value.items`, to run the action once per item
    /// instead of once per message. The action reads the item as `item`.
    #[serde(default)]
    pub split: Option<String>,
    pub action: Action,
}

/// What a route does. A new kind of action is a new variant here; the compiler then finds every
/// runner and exporter that has to handle it.
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum Action {
    Webhook(Webhook),
}

impl Action {
    pub fn body(&self) -> &Body {
        match self {
            Action::Webhook(w) => &w.body,
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Webhook {
    /// Often the secret itself (Slack and Teams hooks).
    pub url: String,
    pub method: HttpMethod,
    #[serde(default)]
    pub headers: Vec<WebhookHeader>,
    #[serde(default)]
    pub body: Body,
}

#[derive(Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Debug)]
#[serde(rename_all = "UPPERCASE")]
pub enum HttpMethod {
    Post,
    Put,
    Patch,
}

impl HttpMethod {
    pub fn as_str(self) -> &'static str {
        match self {
            HttpMethod::Post => "POST",
            HttpMethod::Put => "PUT",
            HttpMethod::Patch => "PATCH",
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
pub struct WebhookHeader {
    pub name: String,
    /// Usually a token.
    pub value: String,
}

// Neither the URL nor a header value may reach a log through `{:?}`.
impl fmt::Debug for Webhook {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Webhook").field("method", &self.method).finish_non_exhaustive()
    }
}

/// What the request body is made of. A new way to build it is a new variant here, a case in
/// `body::render` and one in `body::validate`.
#[derive(Clone, Serialize, Deserialize, Default, Debug)]
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
#[derive(Clone, Serialize, Deserialize, Debug)]
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

#[derive(Clone, Serialize, Deserialize, Debug)]
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

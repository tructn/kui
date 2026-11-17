use std::fmt;

use serde::{Deserialize, Serialize};

/// A saved rule: run `action` for each new message on `topic` that matches `query`.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Automation {
    /// Empty for a new automation; the store assigns one on save.
    #[serde(default)]
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub cluster_id: String,
    pub topic: String,
    /// MQL filter; blank fires on every message.
    #[serde(default)]
    pub query: Option<String>,
    /// Actions beyond this many a minute are dropped, so a busy topic can't flood the target.
    #[serde(default = "default_max_per_minute")]
    pub max_per_minute: u32,
    pub action: Action,
}

pub const DEFAULT_MAX_PER_MINUTE: u32 = 60;
pub const MAX_PER_MINUTE: u32 = 600;

fn default_max_per_minute() -> u32 {
    DEFAULT_MAX_PER_MINUTE
}

/// What an automation does. A new kind of action is a new variant here, a case in
/// `Engine::run_action` and a case in `validate::automation`.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum Action {
    Webhook(Webhook),
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Webhook {
    /// Often the secret itself (Slack and Teams hooks), so it is kept in the keychain.
    pub url: String,
    pub method: HttpMethod,
    #[serde(default)]
    pub headers: Vec<WebhookHeader>,
    #[serde(default)]
    pub body: Body,
}

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
}

#[derive(Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "UPPERCASE")]
pub enum HttpMethod {
    Post,
    Put,
    Patch,
}

impl HttpMethod {
    pub fn as_reqwest(self) -> reqwest::Method {
        match self {
            HttpMethod::Post => reqwest::Method::POST,
            HttpMethod::Put => reqwest::Method::PUT,
            HttpMethod::Patch => reqwest::Method::PATCH,
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
pub struct WebhookHeader {
    pub name: String,
    /// Usually a token, so it is kept in the keychain.
    pub value: String,
}

// Neither the URL nor a header value may reach a log through `{:?}`.
impl fmt::Debug for Webhook {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Webhook").field("method", &self.method.as_reqwest().as_str()).finish_non_exhaustive()
    }
}

/// What an automation is doing right now.
#[derive(Clone, Copy, Serialize, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub enum RunState {
    /// Waiting for messages.
    Running,
    /// Couldn't read the topic; retrying with a growing delay.
    Retrying,
    Stopped,
}

#[derive(Clone, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub id: String,
    pub state: RunState,
    pub fired: u64,
    pub failed: u64,
    /// Matching messages skipped because of `max_per_minute`.
    pub dropped: u64,
    /// Epoch millis of the last attempt.
    pub last_fired_at: Option<i64>,
    /// The latest failure, cleared by the next success. Never contains the URL or a header value.
    pub last_error: Option<String>,
}

impl Status {
    pub fn stopped(id: &str) -> Self {
        Self {
            id: id.to_string(),
            state: RunState::Stopped,
            fired: 0,
            failed: 0,
            dropped: 0,
            last_fired_at: None,
            last_error: None,
        }
    }
}

/// Result of the "Send test" button.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestResult {
    pub status: u16,
}

/// A made-up message to try a body on.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewSample {
    pub topic: String,
    pub key: Option<String>,
    pub value: Option<String>,
    #[serde(default)]
    pub headers: Vec<WebhookHeader>,
}

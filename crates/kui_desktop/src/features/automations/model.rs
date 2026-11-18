use std::fmt;

use serde::{Deserialize, Serialize};

pub use kui_pipeline::{Body, BodyPreview};

/// A saved pipeline: for each new message on `topic` that matches `query`, run every route.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", from = "Stored")]
pub struct Automation {
    /// Empty for a new automation; the store assigns one on save.
    #[serde(default)]
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub cluster_id: String,
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

/// One branch of a pipeline: messages that also match `query` are shaped and sent by `action`.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Route {
    /// Names the route in the editor's graph; unique within the automation.
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

/// An automation as saved, including the single-action shape from before routes.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Stored {
    #[serde(default)]
    id: String,
    name: String,
    enabled: bool,
    cluster_id: String,
    topic: String,
    #[serde(default)]
    query: Option<String>,
    #[serde(default = "default_max_per_minute")]
    max_per_minute: u32,
    #[serde(default)]
    routes: Vec<Route>,
    #[serde(default)]
    action: Option<Action>,
}

impl From<Stored> for Automation {
    fn from(s: Stored) -> Self {
        let mut routes = s.routes;
        if routes.is_empty()
            && let Some(action) = s.action
        {
            routes.push(Route { id: "route-1".to_string(), query: None, split: None, action });
        }
        Self {
            id: s.id,
            name: s.name,
            enabled: s.enabled,
            cluster_id: s.cluster_id,
            topic: s.topic,
            query: s.query,
            max_per_minute: s.max_per_minute,
            routes,
        }
    }
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
#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PreviewSample {
    pub topic: String,
    pub key: Option<String>,
    pub value: Option<String>,
    #[serde(default)]
    pub headers: Vec<WebhookHeader>,
}

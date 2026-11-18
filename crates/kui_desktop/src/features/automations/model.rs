use serde::{Deserialize, Serialize};

pub use kui_pipeline::model::default_max_per_minute;
pub use kui_pipeline::{Action, Body, BodyPreview, HttpMethod, Pipeline, Route, Webhook, WebhookHeader};

/// A saved pipeline: what it does (`pipeline`) plus where and whether it runs in this app.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", from = "Stored")]
pub struct Automation {
    /// Empty for a new automation; the store assigns one on save.
    #[serde(default)]
    pub id: String,
    pub enabled: bool,
    pub cluster_id: String,
    #[serde(flatten)]
    pub pipeline: Pipeline,
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
            enabled: s.enabled,
            cluster_id: s.cluster_id,
            pipeline: Pipeline {
                name: s.name,
                topic: s.topic,
                query: s.query,
                max_per_minute: s.max_per_minute,
                routes,
            },
        }
    }
}

pub fn as_reqwest(method: HttpMethod) -> reqwest::Method {
    match method {
        HttpMethod::Post => reqwest::Method::POST,
        HttpMethod::Put => reqwest::Method::PUT,
        HttpMethod::Patch => reqwest::Method::PATCH,
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

use serde::Serialize;

/// What answered at a local Lambda endpoint.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum EndpointCheck {
    Ready,
    NotRunning { message: String },
    Unexpected { message: String },
}

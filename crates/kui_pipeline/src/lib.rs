//! KUI's pipelines, independent of the app, in three layers:
//!
//! - **The pipeline IR**: what a pipeline is (`model`), whether it is well formed (`validate`) and
//!   its file format (`file`). Everything below takes a pipeline that passed `validate`.
//! - **The native engine**: which routes a message takes and what they send (`router`, `body`,
//!   `template`, `mapping`, `throttle`), and running it over existing messages (`replay`).
//! - **Backends** (`export`): the same pipeline as another tool's configuration, such as Kafka
//!   Connect connectors.
//!
//! It has no Kafka client, Tauri or network dependencies, so every rule is unit-tested; messages
//! come in as a `template::Event`.

pub mod body;
pub mod export;
pub mod file;
mod mapping;
pub mod model;
pub mod replay;
pub mod router;
pub mod template;
pub mod throttle;
pub mod validate;

pub use model::{
    Action, Body, BodyPreview, FieldMapping, HttpMethod, Pipeline, Route, Source, Transform, Webhook, WebhookHeader,
};

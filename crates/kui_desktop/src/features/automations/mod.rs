//! Automations (shown as "Pipelines" in the UI): when a message is published to a topic (and
//! matches an optional filter), run an action such as calling a webhook.
//!
//! What is sent is decided by the `kui_pipeline` crate; this module reads the topic, keeps the
//! automations and sends the requests.

pub mod commands;
mod engine;
pub mod model;
mod store;
mod validate;
mod webhook;

pub use engine::Engine;
pub use store::AutomationStore;

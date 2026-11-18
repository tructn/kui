//! Automations (shown as "Pipelines" in the UI): when a message is published to a topic (and
//! matches an optional filter), run an action such as calling a webhook.
//!
//! What a pipeline is and what it sends is decided by the `kui_pipeline` crate; this module reads
//! the topic, keeps the automations, sends the requests, replays existing messages and publishes
//! pipelines to Kafka Connect.

pub mod commands;
mod connect;
mod engine;
pub mod model;
mod replay;
mod store;
mod validate;
mod webhook;

pub use engine::Engine;
pub use store::AutomationStore;

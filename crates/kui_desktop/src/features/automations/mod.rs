//! Automations: when a message is published to a topic (and matches an optional
//! filter), run an action such as calling a webhook.
//!
//! `template.rs`, `throttle.rs` and `validate.rs` are pure helpers so the parts that
//! decide what is sent, and how often, are unit-testable without Kafka or a network.

mod body;
pub mod commands;
mod engine;
mod mapping;
pub mod model;
mod store;
mod template;
mod throttle;
mod validate;
mod webhook;

pub use engine::Engine;
pub use store::AutomationStore;

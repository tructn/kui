//! Generating fake data and producing it to a topic.
//!
//! `template.rs` is the pure part (parse `{{placeholders}}`, render with the
//! `fake` crate) and is unit-tested without Kafka.

pub mod commands;
pub mod model;
pub mod service;
mod template;

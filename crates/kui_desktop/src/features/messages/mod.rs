//! Browsing (reading), producing and exporting messages.
//!
//! `window.rs`, `codec.rs` and `export.rs` are pure helpers so the tricky parts
//! (which offsets to read, how to show bytes, file formats) are unit-testable
//! without Kafka.

mod codec;
pub mod commands;
mod export;
mod headers;
pub mod model;
mod query;
pub mod service;
mod window;

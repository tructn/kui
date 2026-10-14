//! Browsing (reading) and producing messages.
//!
//! `window.rs` and `codec.rs` are pure helpers so the tricky parts
//! (which offsets to read, how to show bytes) are unit-testable without Kafka.

mod codec;
pub mod commands;
pub mod model;
pub mod service;
mod window;

//! KUI Actions: hand each message of a Kafka topic to locally running code and
//! keep a debugging history of what happened. A local development tool, not a
//! pipeline: it runs only while KUI does, with at-least-once delivery and no
//! retries (see `docs/prd/kui-actions.md`).
//!
//! No Tauri here; `kui_desktop` adapts this crate to commands. rdkafka is used
//! only in `kafka`: the runner reads through `run::MessageSource`, so its
//! delivery guarantees are tested with a fake source, without a broker.

pub mod discovery;
mod error;
pub mod executor;
pub mod kafka;
pub mod lambda;
pub mod model;
pub mod payload;
pub mod record;
pub mod run;
pub mod validate;

pub use error::{Error, Result};
pub use record::Record;

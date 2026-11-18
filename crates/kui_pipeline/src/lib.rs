//! The transform step of KUI's pipelines: turns one Kafka message into the request bodies to
//! send. It has no Kafka, Tauri or network dependencies, so every rule is unit-tested; messages
//! come in as a `template::Event`.

pub mod body;
mod mapping;
pub mod model;
pub mod template;
pub mod throttle;

pub use model::{Body, BodyPreview, FieldMapping, Source, Transform};

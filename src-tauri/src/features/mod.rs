//! One folder per feature. Each feature follows the same layout:
//!
//! - `model.rs`    – data types exchanged with the UI (serialized as camelCase)
//! - `service.rs`  – the Kafka logic; plain Rust, no Tauri
//! - `commands.rs` – thin `#[tauri::command]` adapters that call the service
//!
//! Features only depend on `crate::kafka` (shared infra), never on each other.
//! Even `ClusterConfig`, which every feature takes as input, lives in `kafka`.

pub mod brokers;
pub mod clusters;
pub mod consumer_groups;
pub mod generator;
pub mod messages;
pub mod topics;

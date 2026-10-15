//! Shared Kafka infrastructure used by every feature.
//! Features may depend on this module, but never on each other.

mod client;
mod cluster;
#[allow(unsafe_code)] // librdkafka call rust-rdkafka does not wrap
mod group_offsets;
pub mod metadata;
pub mod offsets;

pub use client::{KafkaClients, client_config, new_consumer};
pub use cluster::ClusterConfig;

use std::time::Duration;

use rdkafka::admin::AdminOptions;

/// Default timeout for any request sent to the cluster.
pub const TIMEOUT: Duration = Duration::from_secs(10);

/// Admin request options using the default `TIMEOUT`.
pub fn admin_options() -> AdminOptions {
    AdminOptions::new().request_timeout(Some(TIMEOUT)).operation_timeout(Some(TIMEOUT))
}

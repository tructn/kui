//! Shared Kafka infrastructure used by every feature.
//! Features may depend on this module, but never on each other.

mod client;
mod cluster;
pub mod metadata;
pub mod offsets;
mod probes;

pub use client::{KafkaClients, client_config, new_consumer};
pub use cluster::ClusterConfig;
pub use probes::Probes;

use std::time::Duration;

use rdkafka::admin::AdminOptions;

/// Default timeout for any request sent to the cluster.
pub const TIMEOUT: Duration = Duration::from_secs(10);

/// Admin request options using the default `TIMEOUT`.
pub fn admin_options() -> AdminOptions {
    AdminOptions::new().request_timeout(Some(TIMEOUT)).operation_timeout(Some(TIMEOUT))
}

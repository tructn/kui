//! Shared Kafka infrastructure for KUI: cluster config, clients, metadata,
//! offsets and consumer groups. Every app feature builds on this crate, but
//! features never depend on each other.

mod client;
mod cluster;
pub mod connection;
mod error;
#[allow(unsafe_code)] // librdkafka call rust-rdkafka does not wrap
mod group_offsets;
#[allow(unsafe_code)] // librdkafka calls rust-rdkafka does not wrap
pub mod groups;
pub mod metadata;
pub mod offsets;

pub use client::{KafkaClients, client_config, created, new_consumer};
pub use cluster::{ClusterConfig, SECRET_PROPERTIES, check_properties, is_secret_property};
pub use connection::KafkaConsumer;
pub use error::{Error, Result};

use std::time::Duration;

use rdkafka::admin::AdminOptions;

/// Default timeout for any request sent to the cluster.
pub const TIMEOUT: Duration = Duration::from_secs(10);

/// Admin request options using the default `TIMEOUT`.
pub fn admin_options() -> AdminOptions {
    AdminOptions::new().request_timeout(Some(TIMEOUT)).operation_timeout(Some(TIMEOUT))
}

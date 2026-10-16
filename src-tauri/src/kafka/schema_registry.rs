use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};

use super::ClusterConfig;
use crate::error::{Error, Result};

/// Registry requests are made while a page of messages is being read, so a
/// slow or unreachable registry must not hold the page for long.
const TIMEOUT: Duration = Duration::from_secs(5);

/// What a schema is written in. The registry omits `schemaType` for Avro.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize, Serialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum SchemaType {
    #[default]
    Avro,
    Protobuf,
    Json,
}

/// Another registered schema this one imports (Avro named types, `.proto` imports).
#[derive(Debug, Clone, Deserialize)]
pub struct SchemaReference {
    /// The Avro full name or the `.proto` import path.
    pub name: String,
    pub subject: String,
    pub version: i32,
}

/// One registered schema, as `GET /schemas/ids/{id}` returns it.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Schema {
    /// Only in subject lookups; a lookup by id already knows it.
    #[serde(default)]
    pub id: Option<u32>,
    #[serde(default)]
    pub version: Option<i32>,
    #[serde(default)]
    pub schema_type: SchemaType,
    pub schema: String,
    #[serde(default)]
    pub references: Vec<SchemaReference>,
}

/// Where decoders look up schemas; a trait so they can be tested without a registry.
pub trait SchemaSource {
    fn by_id(&self, id: u32) -> Result<Arc<Schema>>;
    fn by_subject(&self, subject: &str, version: i32) -> Result<Arc<Schema>>;
}

/// A Confluent-compatible Schema Registry client.
///
/// Registered schemas never change, so every one fetched is cached for the life
/// of the cluster's clients (editing the cluster drops them).
pub struct SchemaRegistry {
    url: String,
    auth: Option<(String, String)>,
    client: reqwest::Client,
    by_id: Mutex<HashMap<u32, Arc<Schema>>>,
    by_subject: Mutex<HashMap<(String, i32), Arc<Schema>>>,
}

impl SchemaRegistry {
    /// `None` when the cluster has no registry URL.
    pub fn from_cluster(cluster: &ClusterConfig) -> Result<Option<Self>> {
        let Some(url) = cluster.schema_registry_url.as_deref().map(str::trim).filter(|u| !u.is_empty()) else {
            return Ok(None);
        };
        let username = cluster.schema_registry_username.as_deref().filter(|u| !u.trim().is_empty());
        let auth = username.map(|u| (u.to_string(), cluster.schema_registry_password.clone().unwrap_or_default()));
        // Same provider the updater installs; whoever gets there first wins.
        let _ = rustls::crypto::ring::default_provider().install_default();
        let client = reqwest::Client::builder()
            .user_agent(concat!("KUI/", env!("CARGO_PKG_VERSION")))
            .timeout(TIMEOUT)
            .build()?;
        Ok(Some(Self {
            url: url.trim_end_matches('/').to_string(),
            auth,
            client,
            by_id: Mutex::default(),
            by_subject: Mutex::default(),
        }))
    }

    /// The newest version registered under `subject`. Not cached: a subject gains versions.
    pub fn latest(&self, subject: &str) -> Result<Schema> {
        self.fetch(&format!("/subjects/{}/versions/latest", url_path_segment(subject)))
    }

    /// Every subject name, sorted.
    pub fn subjects(&self) -> Result<Vec<String>> {
        let mut subjects: Vec<String> = self.fetch("/subjects")?;
        subjects.sort();
        Ok(subjects)
    }

    /// Fetches `path` and parses its JSON body. Blocks, so like the librdkafka
    /// calls it must run on a blocking thread, never inside an async task.
    fn fetch<T: serde::de::DeserializeOwned>(&self, path: &str) -> Result<T> {
        let mut request = self.client.get(format!("{}{path}", self.url));
        if let Some((user, password)) = &self.auth {
            request = request.basic_auth(user, Some(password));
        }
        tauri::async_runtime::block_on(async {
            let response = request.send().await?;
            let status = response.status();
            if !status.is_success() {
                let body = response.text().await.unwrap_or_default();
                return Err(Error::msg(format!("Schema Registry answered {status} for {path}: {}", body.trim())));
            }
            Ok(response.json().await?)
        })
    }
}

impl SchemaSource for SchemaRegistry {
    fn by_id(&self, id: u32) -> Result<Arc<Schema>> {
        if let Some(cached) = self.by_id.lock().unwrap().get(&id) {
            return Ok(cached.clone());
        }
        let schema: Arc<Schema> = Arc::new(self.fetch(&format!("/schemas/ids/{id}"))?);
        self.by_id.lock().unwrap().insert(id, schema.clone());
        Ok(schema)
    }

    fn by_subject(&self, subject: &str, version: i32) -> Result<Arc<Schema>> {
        let key = (subject.to_string(), version);
        if let Some(cached) = self.by_subject.lock().unwrap().get(&key) {
            return Ok(cached.clone());
        }
        let subject_path = url_path_segment(subject);
        let schema: Arc<Schema> = Arc::new(self.fetch(&format!("/subjects/{subject_path}/versions/{version}"))?);
        self.by_subject.lock().unwrap().insert(key, schema.clone());
        Ok(schema)
    }
}

/// Percent-encodes everything but unreserved characters, so a subject like
/// `orders-value` or `com.acme/Order` is a single path segment.
fn url_path_segment(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn avro_is_the_default_schema_type() {
        let s: Schema = serde_json::from_str(r#"{"schema":"\"string\""}"#).unwrap();
        assert_eq!(s.schema_type, SchemaType::Avro);
        let s: Schema = serde_json::from_str(
            r#"{"schemaType":"PROTOBUF","schema":"syntax = \"proto3\";","references":[{"name":"a.proto","subject":"a","version":1}]}"#,
        )
        .unwrap();
        assert_eq!(s.schema_type, SchemaType::Protobuf);
        assert_eq!(s.references[0].name, "a.proto");
    }

    #[test]
    fn subjects_are_one_path_segment() {
        assert_eq!(url_path_segment("orders-value"), "orders-value");
        assert_eq!(url_path_segment("com.acme/Order"), "com.acme%2FOrder");
    }

    #[test]
    fn no_url_means_no_registry() {
        let cluster: ClusterConfig =
            serde_json::from_value(serde_json::json!({"name": "x", "bootstrapServers": "b", "schemaRegistryUrl": " "}))
                .unwrap();
        assert!(SchemaRegistry::from_cluster(&cluster).unwrap().is_none());
    }
}

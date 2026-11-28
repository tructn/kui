use std::collections::BTreeMap;

use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Discovery {
    pub project_dir: String,
    /// The template read, relative to the project directory.
    pub template: String,
    pub functions: Vec<DiscoveredFunction>,
    /// Resources KUI saw but can't offer, with the reason.
    pub skipped: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredFunction {
    pub logical_id: String,
    pub resource_type: String,
    pub function_name: ConfiguredName,
    pub runtime: Option<String>,
    pub handler: Option<String>,
    pub code_uri: Option<String>,
    pub package_type: Option<String>,
    /// Topics of the function's `MSK` / `SelfManagedKafka` events.
    pub kafka_topics: Vec<String>,
    pub metadata: BTreeMap<String, String>,
}

/// A function's `FunctionName` property.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", content = "value", rename_all = "camelCase")]
pub enum ConfiguredName {
    NotSet,
    Literal(String),
    /// Built with an intrinsic like `!Sub`, which KUI doesn't evaluate.
    Computed,
}

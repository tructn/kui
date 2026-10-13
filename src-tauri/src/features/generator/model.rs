use serde::{Deserialize, Serialize};

/// Language/region for names, addresses, phone numbers and so on.
#[derive(Debug, Deserialize, Clone, Copy, Default, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Locale {
    #[default]
    En,
    FrFr,
    DeDe,
    ItIt,
    NlNl,
    PtBr,
    JaJp,
    ZhCn,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HeaderTemplate {
    pub key: String,
    pub value: String,
}

/// The templates for one record; shared by preview and generate.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordTemplate {
    /// Empty or missing means no key (the partitioner spreads records round-robin).
    pub key: Option<String>,
    pub value: String,
    #[serde(default)]
    pub headers: Vec<HeaderTemplate>,
    #[serde(default)]
    pub locale: Locale,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateRequest {
    pub topic: String,
    /// `None` lets the partitioner decide.
    pub partition: Option<i32>,
    pub template: RecordTemplate,
    pub count: u64,
    /// Messages per second; `None` or 0 means as fast as possible.
    pub rate: Option<u32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedHeader {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedRecord {
    pub key: Option<String>,
    pub value: String,
    pub headers: Vec<GeneratedHeader>,
}

#[derive(Debug, Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct GenerateProgress {
    pub total: u64,
    pub sent: u64,
    pub failed: u64,
    /// The first delivery error, so the UI can explain why `failed` > 0.
    pub first_error: Option<String>,
    pub elapsed_ms: u64,
}

/// One entry in the placeholder cheat sheet.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratorInfo {
    pub name: String,
    pub example: String,
    pub description: String,
}

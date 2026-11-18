//! A pipeline saved as a file, to keep next to a service, share, or import on another machine.
//!
//! ```json
//! { "kind": "kui.pipeline", "version": 1, "pipeline": { "name": "...", "topic": "...", "routes": [...] } }
//! ```
//!
//! Webhook URLs and header values are usually credentials, so the file never holds them: they
//! are written blank and filled in again after an import.

use serde::{Deserialize, Serialize};

use crate::model::{Action, Pipeline};
use crate::validate;

const KIND: &str = "kui.pipeline";
const VERSION: u32 = 1;
/// A pipeline is a few KiB; anything far larger isn't one.
pub const MAX_FILE: usize = 1024 * 1024;

#[derive(Serialize, Deserialize)]
struct PipelineFile {
    kind: String,
    version: u32,
    pipeline: Pipeline,
}

/// The pipeline with every webhook URL and header value blanked.
pub fn without_secrets(pipeline: &Pipeline) -> Pipeline {
    let mut pipeline = pipeline.clone();
    for route in &mut pipeline.routes {
        match &mut route.action {
            Action::Webhook(w) => {
                w.url.clear();
                w.headers.iter_mut().for_each(|h| h.value.clear());
            }
        }
    }
    pipeline
}

/// The values `without_secrets` removes, for redacting text that might repeat them.
pub fn secrets(pipeline: &Pipeline) -> Vec<&str> {
    pipeline
        .routes
        .iter()
        .flat_map(|route| match &route.action {
            Action::Webhook(w) => std::iter::once(w.url.as_str()).chain(w.headers.iter().map(|h| h.value.as_str())),
        })
        .filter(|s| !s.trim().is_empty())
        .collect()
}

pub fn write(pipeline: &Pipeline) -> String {
    let file = PipelineFile { kind: KIND.to_string(), version: VERSION, pipeline: without_secrets(pipeline) };
    // A struct of strings and numbers always serializes.
    serde_json::to_string_pretty(&file).unwrap_or_default() + "\n"
}

/// Reads a pipeline file. What comes back is valid IR (see `validate`), still without credentials.
pub fn read(text: &str) -> Result<Pipeline, String> {
    if text.len() > MAX_FILE {
        return Err("The file is too large to be a pipeline.".to_string());
    }
    #[derive(Deserialize)]
    struct Header {
        kind: Option<String>,
        version: Option<u32>,
    }
    let not_a_pipeline = || "The file isn't a KUI pipeline.".to_string();
    let header: Header = serde_json::from_str(text).map_err(|_| not_a_pipeline())?;
    if header.kind.as_deref() != Some(KIND) {
        return Err(not_a_pipeline());
    }
    match header.version {
        Some(VERSION) => {}
        Some(v) if v > VERSION => {
            return Err(format!("The pipeline was saved by a newer KUI (format {v}). Update KUI to open it."));
        }
        _ => return Err(not_a_pipeline()),
    }
    let file: PipelineFile =
        serde_json::from_str(text).map_err(|e| format!("The pipeline file is damaged (line {}).", e.line()))?;
    validate::pipeline(&file.pipeline)?;
    // Whatever the file says, secrets are entered on this machine.
    Ok(without_secrets(&file.pipeline))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Body, HttpMethod, Route, Webhook, WebhookHeader};

    fn pipeline() -> Pipeline {
        Pipeline {
            name: "Orders".into(),
            topic: "orders".into(),
            query: Some("value.status = 'failed'".into()),
            max_per_minute: 30,
            routes: vec![Route {
                id: "route-1".into(),
                query: None,
                split: Some("value.items".into()),
                action: Action::Webhook(Webhook {
                    url: "https://hooks.example.com/SECRET-URL".into(),
                    method: HttpMethod::Put,
                    headers: vec![WebhookHeader { name: "Authorization".into(), value: "SECRET-TOKEN".into() }],
                    body: Body::Template { text: "{{item}}".into() },
                }),
            }],
        }
    }

    #[test]
    fn a_saved_pipeline_reads_back_without_its_secrets() {
        let text = write(&pipeline());
        assert!(!text.contains("SECRET"), "the pipeline file holds a credential");

        let back = read(&text).unwrap();
        assert_eq!(
            (back.name.as_str(), back.max_per_minute, back.routes[0].split.as_deref()),
            ("Orders", 30, Some("value.items"))
        );
        let Action::Webhook(w) = &back.routes[0].action;
        assert_eq!((w.url.as_str(), w.method, w.headers[0].name.as_str()), ("", HttpMethod::Put, "Authorization"));
    }

    #[test]
    fn secrets_written_into_a_file_by_hand_are_dropped() {
        let text = serde_json::json!({ "kind": "kui.pipeline", "version": 1, "pipeline": pipeline() }).to_string();
        assert!(secrets(&read(&text).unwrap()).is_empty());
    }

    #[test]
    fn other_files_and_newer_formats_are_refused() {
        assert!(read("[]").unwrap_err().contains("isn't a KUI pipeline"));
        assert!(read(r#"{"kind":"other","version":1}"#).unwrap_err().contains("isn't a KUI pipeline"));
        assert!(read(r#"{"kind":"kui.pipeline","version":2}"#).unwrap_err().contains("newer KUI"));
        assert!(read(r#"{"kind":"kui.pipeline","version":1,"pipeline":{}}"#).unwrap_err().contains("damaged"));
        assert!(read(&" ".repeat(MAX_FILE + 1)).unwrap_err().contains("too large"));

        let mut invalid = pipeline();
        invalid.topic.clear();
        let text = serde_json::json!({ "kind": "kui.pipeline", "version": 1, "pipeline": invalid }).to_string();
        assert!(read(&text).unwrap_err().contains("topic"));
    }

    #[test]
    fn secrets_lists_every_url_and_header_value() {
        assert_eq!(secrets(&pipeline()), ["https://hooks.example.com/SECRET-URL", "SECRET-TOKEN"]);
    }
}

//! Turns a message into the request body, however the automation was set up to do it.

use serde_json::Value;

use super::model::Body;
use super::template::{self, Event, Lookup};
use super::{mapping, validate::MAX_BODY};

/// Why `body` can't be used.
pub fn validate(body: &Body) -> Result<(), String> {
    match body {
        Body::Envelope => Ok(()),
        Body::Template { text } => {
            if text.len() > MAX_BODY {
                return Err("The body template is too long.".to_string());
            }
            template::validate(text).map_err(|e| format!("Body template: {e}"))
        }
        Body::Mapping { fields } => {
            let size = serde_json::to_string(fields).map_or(usize::MAX, |s| s.len());
            if size > MAX_BODY {
                return Err("The field mapping is too large.".to_string());
            }
            mapping::validate(fields).map_err(|e| format!("Field mapping: {e}"))
        }
    }
}

pub fn render(body: &Body, automation: &str, event: &Event<'_>) -> Result<String, String> {
    match body {
        Body::Envelope => Ok(event.envelope(automation)),
        Body::Template { text } => template::render(text, event),
        Body::Mapping { fields } => mapping::apply(fields, &Lookup::new(event)).map(|value| value.to_string()),
    }
}

/// `render`, indented when the result is JSON, for showing to the user.
pub fn preview(body: &Body, automation: &str, event: &Event<'_>) -> Result<String, String> {
    validate(body)?;
    let text = render(body, automation, event)?;
    Ok(match serde_json::from_str::<Value>(&text) {
        Ok(json) => serde_json::to_string_pretty(&json).unwrap_or(text),
        Err(_) => text,
    })
}

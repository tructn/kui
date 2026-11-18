//! Where a replay's messages come from: read back from the topic, or a message export the user
//! opened. Running them through the pipeline is `kui_pipeline::replay`.

use std::path::Path;

use serde::Deserialize;

use kui_kafka::KafkaClients;
use kui_pipeline::replay::{self, Loaded, MAX_MESSAGES, ReplayHeader, ReplayMessage, iso_timestamp};

use crate::error::{Error, Result};
use crate::features::messages::model::{BrowseRequest, Message, StartFrom};
use crate::features::messages::service::browse;

/// Every key, value and header of a replay together; a file or IPC call beyond this is refused.
const MAX_BYTES: usize = 32 * 1024 * 1024;
const PAGE_SIZE: usize = 250;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum ReplaySource {
    /// Read from the pipeline's topic.
    Topic { from: ReplayFrom, limit: usize },
    /// Messages from a file opened with `load_replay_file`. They come back through the webview,
    /// so they are checked again here.
    Messages { messages: Vec<ReplayMessage> },
}

#[derive(Deserialize, Clone, Copy)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum ReplayFrom {
    /// The oldest messages the topic keeps.
    Earliest,
    /// The newest `limit` messages, replayed oldest first.
    Latest,
    /// Messages at or after an epoch-millis time.
    Timestamp { millis: i64 },
}

pub fn check(messages: &[ReplayMessage]) -> Result<()> {
    if messages.is_empty() {
        return Err(Error::msg("There are no messages to replay."));
    }
    if messages.len() > MAX_MESSAGES {
        return Err(Error::msg(format!("A replay takes up to {MAX_MESSAGES} messages.")));
    }
    if messages.iter().map(ReplayMessage::size).sum::<usize>() > MAX_BYTES {
        return Err(Error::msg("The messages are too large to replay together."));
    }
    Ok(())
}

/// Reads up to `limit` messages of `topic`, oldest first.
pub fn read_topic(clients: &KafkaClients, topic: &str, from: ReplayFrom, limit: usize) -> Result<Vec<ReplayMessage>> {
    let (start, value) = match from {
        ReplayFrom::Earliest => (StartFrom::Earliest, None),
        ReplayFrom::Latest => (StartFrom::Latest, None),
        ReplayFrom::Timestamp { millis } => (StartFrom::Timestamp, Some(millis)),
    };
    let mut left = limit.clamp(1, MAX_MESSAGES);
    let mut cursor = None;
    let mut messages = Vec::new();
    while left > 0 {
        let request = BrowseRequest {
            topic: topic.to_string(),
            partition: None,
            from: start,
            value,
            page_size: left.min(PAGE_SIZE),
            cursor: cursor.clone(),
            query: None,
        };
        let page = browse(clients, &request)?;
        let read = page.messages.len().min(left);
        messages.extend(page.messages.into_iter().take(read).map(|m| replay_message(topic, m)));
        left -= read;
        // Stop at the end, or if a page made no progress (so it can never spin).
        match page.next {
            Some(next) if read > 0 && cursor.as_ref() != Some(&next) => cursor = Some(next),
            _ => break,
        }
    }
    if start == StartFrom::Latest {
        messages.reverse();
    }
    Ok(messages)
}

fn replay_message(topic: &str, m: Message) -> ReplayMessage {
    let truncated = m.key.iter().chain(m.value.iter()).any(|p| p.truncated);
    let encoding = |p: &Option<crate::features::messages::model::Payload>| p.as_ref().map(|p| p.encoding.to_string());
    ReplayMessage {
        topic: Some(topic.to_string()),
        partition: m.partition,
        offset: m.offset,
        timestamp: iso_timestamp(m.timestamp),
        key_encoding: encoding(&m.key),
        value_encoding: encoding(&m.value),
        key: m.key.map(|p| p.text),
        value: m.value.map(|p| p.text),
        headers: m.headers.into_iter().map(|h| ReplayHeader { key: h.key, value: h.value }).collect(),
        truncated,
    }
}

/// Reads a message export the user picked.
pub fn load_file(path: &Path) -> Result<Loaded> {
    let size = std::fs::metadata(path)?.len();
    if size > MAX_BYTES as u64 {
        return Err(Error::msg("The file is too large to replay. Export fewer messages."));
    }
    let text = std::fs::read_to_string(path).map_err(|_| Error::msg("The file isn't a text file."))?;
    replay::parse_messages(&text).map_err(Error::msg)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_replay_needs_some_messages_but_not_too_many() {
        assert!(check(&[]).is_err());
        assert!(check(&vec![ReplayMessage::default(); MAX_MESSAGES + 1]).is_err());
        let huge = ReplayMessage { value: Some("x".repeat(MAX_BYTES + 1)), ..ReplayMessage::default() };
        assert!(check(&[huge]).unwrap_err().to_string().contains("too large"));
        check(&[ReplayMessage::default()]).unwrap();
    }

    #[test]
    fn a_large_file_is_refused_before_it_is_read() {
        let path = std::env::temp_dir().join(format!("kui-replay-{}.json", uuid::Uuid::new_v4()));
        std::fs::write(&path, r#"[{"offset":3,"value":"a"}]"#).unwrap();
        assert_eq!(load_file(&path).unwrap().messages[0].offset, 3);
        std::fs::File::options().write(true).open(&path).unwrap().set_len(MAX_BYTES as u64 + 1).unwrap();
        assert!(load_file(&path).err().unwrap().to_string().contains("too large"));
        std::fs::remove_file(path).ok();
    }
}

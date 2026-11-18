//! Turns a pipeline into the configuration of another tool, so it can run on a server instead
//! of in KUI. Each target is its own module; only what the target can express exactly is
//! translated, and everything else is reported as a blocker rather than silently changed.

pub mod kafka_connect;

/// Replaces every occurrence of a secret in `text`, so a config preview or a server's error
/// message never shows one.
pub fn redact(text: &str, secrets: &[&str]) -> String {
    secrets.iter().filter(|s| !s.is_empty()).fold(text.to_string(), |text, secret| text.replace(secret, HIDDEN))
}

pub const HIDDEN: &str = "<hidden>";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_secret_is_hidden_and_empty_ones_are_ignored() {
        assert_eq!(
            redact("url=https://h/SECRET token=T0K", &["https://h/SECRET", "T0K", ""]),
            "url=<hidden> token=<hidden>"
        );
    }
}

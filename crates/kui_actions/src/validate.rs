//! Checks on an Action from the UI before it's saved or run.

use reqwest::Url;

use crate::model::{Action, Executor, LambdaTarget};
use crate::{Error, Result};

pub const MAX_TIMEOUT_SECS: u32 = 900;
pub const MAX_CONCURRENCY: u8 = 8;
const MAX_NAME: usize = 100;
/// Kafka's own limit for group ids and topic names.
const MAX_KAFKA_NAME: usize = 249;
/// Lambda's limit for a function name.
const MAX_FUNCTION_NAME: usize = 140;

pub fn action(action: &Action) -> Result<()> {
    let name = action.name.trim();
    if name.is_empty() || name.chars().count() > MAX_NAME {
        return Err(Error::msg(format!("Give the action a name of 1 to {MAX_NAME} characters")));
    }
    if action.source.topic.is_empty() || action.source.topic.len() > MAX_KAFKA_NAME {
        return Err(Error::msg("Choose a topic"));
    }
    let group = action.source.group_id.trim();
    if group.is_empty() || group.len() > MAX_KAFKA_NAME {
        return Err(Error::msg(format!("The consumer group needs 1 to {MAX_KAFKA_NAME} characters")));
    }
    match &action.executor {
        Executor::LocalLambda(target) => lambda_target(target),
    }
}

fn lambda_target(target: &LambdaTarget) -> Result<()> {
    endpoint(&target.endpoint)?;
    function_name(&target.function_name)?;
    if !(1..=MAX_TIMEOUT_SECS).contains(&target.timeout_secs) {
        return Err(Error::msg(format!("The timeout must be 1 to {MAX_TIMEOUT_SECS} seconds")));
    }
    if !(1..=MAX_CONCURRENCY).contains(&target.concurrency) {
        return Err(Error::msg(format!("Concurrency must be 1 to {MAX_CONCURRENCY}")));
    }
    // A run stops at the first unanswered message; with several in flight the
    // others would finish, and be committed, past it.
    if target.debug && target.concurrency != 1 {
        return Err(Error::msg("Debug mode sends one message at a time: set concurrency to 1"));
    }
    Ok(())
}

/// An `http(s)` URL with a host and nothing after it but an optional `/`.
pub fn endpoint(endpoint: &str) -> Result<Url> {
    let invalid = || Error::msg("The endpoint must look like http://127.0.0.1:3001");
    let url = Url::parse(endpoint.trim()).map_err(|_| invalid())?;
    let bare = url.path() == "/" && url.query().is_none() && url.fragment().is_none();
    let credentials = !url.username().is_empty() || url.password().is_some();
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() || !bare || credentials {
        return Err(invalid());
    }
    Ok(url)
}

/// What SAM accepts as a function identifier (a logical ID or a Lambda name),
/// which is also safe in the Test Tool's URL path.
pub fn function_name(name: &str) -> Result<()> {
    let allowed = |c: char| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | ':');
    if name.is_empty() || name.len() > MAX_FUNCTION_NAME || !name.chars().all(allowed) {
        return Err(Error::msg("Choose a function (letters, digits, '-', '_', '.' or ':')"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{LambdaRuntime, PayloadFormat, Source, StartFrom};

    fn sample() -> Action {
        Action {
            id: String::new(),
            name: "Orders".into(),
            cluster_id: "local".into(),
            source: Source {
                topic: "demo.orders".into(),
                group_id: "kui-action-orders".into(),
                start_from: StartFrom::Latest,
            },
            executor: Executor::LocalLambda(LambdaTarget {
                runtime: LambdaRuntime::Sam,
                endpoint: "http://127.0.0.1:3001".into(),
                function_name: "OrderProcessor".into(),
                project_dir: None,
                payload: PayloadFormat::Msk,
                timeout_secs: 30,
                concurrency: 1,
                debug: false,
            }),
        }
    }

    fn with_target(change: impl FnOnce(&mut LambdaTarget)) -> Action {
        let mut action = sample();
        let Executor::LocalLambda(target) = &mut action.executor;
        change(target);
        action
    }

    #[test]
    fn accepts_a_complete_action() {
        assert!(action(&sample()).is_ok());
    }

    #[test]
    fn rejects_blank_names_topics_and_groups() {
        for change in [
            (|a: &mut Action| a.name = "  ".into()) as fn(&mut Action),
            |a| a.source.topic.clear(),
            |a| a.source.group_id = " ".into(),
        ] {
            let mut a = sample();
            change(&mut a);
            assert!(action(&a).is_err());
        }
    }

    #[test]
    fn endpoints_are_bare_http_urls() {
        for ok in ["http://127.0.0.1:3001", "http://localhost:3001/", "https://sam.local"] {
            assert!(endpoint(ok).is_ok(), "{ok}");
        }
        for bad in ["127.0.0.1:3001", "file:///etc/passwd", "http://127.0.0.1:3001/x", "http://u:p@host", "ftp://h"] {
            assert!(endpoint(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn function_names_cannot_escape_the_url_path() {
        assert!(function_name("Order-Processor_1").is_ok());
        assert!(function_name("arn:aws:lambda:local:fn").is_ok());
        for bad in ["", "../admin", "a/b", "a?b=1", "a b", &"x".repeat(141)] {
            assert!(function_name(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn limits_timeout_and_concurrency() {
        assert!(action(&with_target(|t| t.timeout_secs = 0)).is_err());
        assert!(action(&with_target(|t| t.timeout_secs = MAX_TIMEOUT_SECS + 1)).is_err());
        assert!(action(&with_target(|t| t.concurrency = 0)).is_err());
        assert!(action(&with_target(|t| t.concurrency = MAX_CONCURRENCY + 1)).is_err());
    }

    #[test]
    fn debug_mode_runs_one_message_at_a_time() {
        assert!(action(&with_target(|t| t.debug = true)).is_ok());
        assert!(action(&with_target(|t| (t.debug, t.concurrency) = (true, 2))).is_err());
    }

    #[test]
    fn actions_saved_before_runtimes_and_debug_load_as_sam() {
        let saved = r#"{"endpoint":"http://127.0.0.1:3001","functionName":"Fn","payload":"msk","timeoutSecs":30,"concurrency":1}"#;
        let target: LambdaTarget = serde_json::from_str(saved).unwrap();
        assert_eq!((target.runtime, target.debug), (LambdaRuntime::Sam, false));
    }
}

//! Checks an automation from the UI. The webview isn't a trust boundary, so everything is
//! checked again here, and a message never repeats a URL or header value.

use super::model::{Action, Automation, MAX_PER_MINUTE};
use super::{body, webhook};
use crate::error::{Error, Result};

const MAX_NAME: usize = 100;
/// Kafka's own limit for a topic name.
const MAX_TOPIC: usize = 249;
const MAX_HEADERS: usize = 20;
pub const MAX_BODY: usize = 64 * 1024;

pub fn automation(a: &Automation) -> Result<()> {
    if a.name.trim().is_empty() || a.name.chars().count() > MAX_NAME {
        return Err(Error::msg(format!("Give the automation a name of up to {MAX_NAME} characters.")));
    }
    if a.topic.trim().is_empty() || a.topic.len() > MAX_TOPIC {
        return Err(Error::msg("Choose the topic to watch."));
    }
    if a.max_per_minute == 0 || a.max_per_minute > MAX_PER_MINUTE {
        return Err(Error::msg(format!("The rate limit must be between 1 and {MAX_PER_MINUTE} a minute.")));
    }
    if let Some(query) = a.query.as_deref().map(str::trim).filter(|q| !q.is_empty()) {
        kui_mql::Query::parse(query).map_err(|e| Error::msg(format!("Invalid filter: {e}")))?;
    }
    match &a.action {
        Action::Webhook(w) => {
            webhook::parse_url(&w.url).map_err(Error::msg)?;
            if w.headers.len() > MAX_HEADERS {
                return Err(Error::msg(format!("A webhook can have up to {MAX_HEADERS} headers.")));
            }
            webhook::build_headers(w).map_err(Error::msg)?;
            body::validate(&w.body).map_err(Error::msg)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::features::automations::model::{Body, HttpMethod, Webhook, WebhookHeader};

    fn valid() -> Automation {
        Automation {
            id: String::new(),
            name: "Alert".into(),
            enabled: true,
            cluster_id: "c".into(),
            topic: "orders".into(),
            query: Some("value.status = 'failed'".into()),
            max_per_minute: 60,
            action: Action::Webhook(Webhook {
                url: "https://hooks.example.com/SECRET".into(),
                method: HttpMethod::Post,
                headers: vec![WebhookHeader { name: "Authorization".into(), value: "Bearer SECRET".into() }],
                body: Body::Template { text: r#"{"order": {{value.id | json}}}"#.into() },
            }),
        }
    }

    fn with(change: impl FnOnce(&mut Automation)) -> String {
        let mut a = valid();
        change(&mut a);
        automation(&a).unwrap_err().to_string()
    }

    #[test]
    fn accepts_a_complete_automation() {
        automation(&valid()).unwrap();
    }

    #[test]
    fn rejects_each_bad_field_with_a_message_that_leaks_nothing() {
        assert!(with(|a| a.name = "  ".into()).contains("name"));
        assert!(with(|a| a.topic = String::new()).contains("topic"));
        assert!(with(|a| a.max_per_minute = 0).contains("rate limit"));
        assert!(with(|a| a.max_per_minute = MAX_PER_MINUTE + 1).contains("rate limit"));
        assert!(with(|a| a.query = Some("value.x =".into())).contains("filter"));
        for message in [
            with(|a| {
                let Action::Webhook(w) = &mut a.action;
                w.url = "ftp://SECRET.example.com".into();
            }),
            with(|a| {
                let Action::Webhook(w) = &mut a.action;
                w.headers[0].value = "bad\nSECRET".into();
            }),
        ] {
            assert!(!message.contains("SECRET"), "{message}");
        }
    }
}

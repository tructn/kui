//! Checks an automation from the UI. The webview isn't a trust boundary, so everything is
//! checked again here, and a message never repeats a URL or header value.

use super::model::{Action, Automation, MAX_PER_MINUTE, Route};
use kui_pipeline::body;
use kui_pipeline::template::{self, Scope};

use super::webhook;
use crate::error::{Error, Result};

const MAX_NAME: usize = 100;
/// Kafka's own limit for a topic name.
const MAX_TOPIC: usize = 249;
const MAX_HEADERS: usize = 20;
const MAX_SPLIT_PATH: usize = 200;
const MAX_ROUTES: usize = 10;
const MAX_ROUTE_ID: usize = 64;

fn check_query(query: Option<&str>) -> Result<()> {
    if let Some(query) = query.map(str::trim).filter(|q| !q.is_empty()) {
        kui_mql::Query::parse(query).map_err(|e| Error::msg(format!("Invalid filter: {e}")))?;
    }
    Ok(())
}

fn route(r: &Route) -> Result<()> {
    if r.id.trim().is_empty() || r.id.len() > MAX_ROUTE_ID {
        return Err(Error::msg("Every route needs an id."));
    }
    check_query(r.query.as_deref())?;
    if let Some(split) = &r.split {
        if split.trim().is_empty() || split.len() > MAX_SPLIT_PATH {
            return Err(Error::msg("Choose the list to send one request per item of."));
        }
        template::validate_path(split, Scope::Message).map_err(|e| Error::msg(format!("Requests per item: {e}")))?;
    }
    match &r.action {
        Action::Webhook(w) => {
            webhook::parse_url(&w.url).map_err(Error::msg)?;
            if w.headers.len() > MAX_HEADERS {
                return Err(Error::msg(format!("A webhook can have up to {MAX_HEADERS} headers.")));
            }
            webhook::build_headers(w).map_err(Error::msg)?;
            body::validate(&w.body, body::scope_of(r.split.as_deref())).map_err(Error::msg)?;
        }
    }
    Ok(())
}

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
    check_query(a.query.as_deref())?;
    if a.routes.is_empty() || a.routes.len() > MAX_ROUTES {
        return Err(Error::msg(format!("A pipeline needs between 1 and {MAX_ROUTES} routes.")));
    }
    for (index, route) in a.routes.iter().enumerate() {
        // Only name the route when there is more than one to tell apart.
        let context = |e: Error| match a.routes.len() {
            1 => e,
            _ => Error::msg(format!("Route {}: {e}", index + 1)),
        };
        self::route(route).map_err(context)?;
        if a.routes[..index].iter().any(|r| r.id == route.id) {
            return Err(Error::msg("Two routes have the same id."));
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
            routes: vec![Route {
                id: "r1".into(),
                query: None,
                split: None,
                action: Action::Webhook(Webhook {
                    url: "https://hooks.example.com/SECRET".into(),
                    method: HttpMethod::Post,
                    headers: vec![WebhookHeader { name: "Authorization".into(), value: "Bearer SECRET".into() }],
                    body: Body::Template { text: r#"{"order": {{value.id | json}}}"#.into() },
                }),
            }],
        }
    }

    fn webhook(a: &mut Automation) -> &mut Webhook {
        let Action::Webhook(w) = &mut a.routes[0].action;
        w
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
        assert!(with(|a| a.routes[0].split = Some("item".into())).contains("Requests per item"));
        assert!(with(|a| a.routes[0].split = Some(" ".into())).contains("list"));
        assert!(with(|a| a.routes[0].query = Some("value.x =".into())).contains("filter"));
        assert!(with(|a| a.routes.clear()).contains("routes"));
        for message in [
            with(|a| webhook(a).url = "ftp://SECRET.example.com".into()),
            with(|a| webhook(a).headers[0].value = "bad\nSECRET".into()),
        ] {
            assert!(!message.contains("SECRET"), "{message}");
        }
    }

    #[test]
    fn names_the_route_at_fault_once_there_are_several() {
        let mut a = valid();
        let mut second = a.routes[0].clone();
        second.id = "r2".into();
        let Action::Webhook(w) = &mut second.action;
        w.url = "nope".into();
        a.routes.push(second);
        assert!(automation(&a).unwrap_err().to_string().starts_with("Route 2: "));

        a.routes[1] = a.routes[0].clone();
        assert!(automation(&a).unwrap_err().to_string().contains("same id"));
    }
}

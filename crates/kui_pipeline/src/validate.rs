//! Whether a pipeline is well formed, whatever runs it: KUI's own engine, a replay or an export.
//! Every runner and exporter may assume a pipeline that passed this. Credentials aren't checked
//! here: a pipeline opened from a file has none yet, and what makes a URL or header sendable is
//! up to the HTTP client that sends it.

use crate::body;
use crate::model::{Action, MAX_PER_MINUTE, Pipeline, Route};
use crate::template::{self, Scope};

const MAX_NAME: usize = 100;
/// Kafka's own limit for a topic name.
const MAX_TOPIC: usize = 249;
pub const MAX_HEADERS: usize = 20;
const MAX_SPLIT_PATH: usize = 200;
pub const MAX_ROUTES: usize = 10;
const MAX_ROUTE_ID: usize = 64;

fn check_query(query: Option<&str>) -> Result<(), String> {
    if let Some(query) = query.map(str::trim).filter(|q| !q.is_empty()) {
        kui_mql::Query::parse(query).map_err(|e| format!("Invalid filter: {e}"))?;
    }
    Ok(())
}

fn route(r: &Route) -> Result<(), String> {
    if r.id.trim().is_empty() || r.id.len() > MAX_ROUTE_ID {
        return Err("Every route needs an id.".to_string());
    }
    check_query(r.query.as_deref())?;
    if let Some(split) = &r.split {
        if split.trim().is_empty() || split.len() > MAX_SPLIT_PATH {
            return Err("Choose the list to send one request per item of.".to_string());
        }
        template::validate_path(split, Scope::Message).map_err(|e| format!("Requests per item: {e}"))?;
    }
    match &r.action {
        Action::Webhook(w) => {
            if w.headers.len() > MAX_HEADERS {
                return Err(format!("A webhook can have up to {MAX_HEADERS} headers."));
            }
            body::validate(&w.body, body::scope_of(r.split.as_deref()))?;
        }
    }
    Ok(())
}

/// "Route 2: ..." once there is more than one route to tell apart.
pub fn route_context(pipeline: &Pipeline, index: usize, why: String) -> String {
    match pipeline.routes.len() {
        1 => why,
        _ => format!("Route {}: {why}", index + 1),
    }
}

pub fn pipeline(p: &Pipeline) -> Result<(), String> {
    if p.name.trim().is_empty() || p.name.chars().count() > MAX_NAME {
        return Err(format!("Give the pipeline a name of up to {MAX_NAME} characters."));
    }
    if p.topic.trim().is_empty() || p.topic.len() > MAX_TOPIC {
        return Err("Choose the topic to watch.".to_string());
    }
    if p.max_per_minute == 0 || p.max_per_minute > MAX_PER_MINUTE {
        return Err(format!("The rate limit must be between 1 and {MAX_PER_MINUTE} a minute."));
    }
    check_query(p.query.as_deref())?;
    if p.routes.is_empty() || p.routes.len() > MAX_ROUTES {
        return Err(format!("A pipeline needs between 1 and {MAX_ROUTES} routes."));
    }
    for (index, r) in p.routes.iter().enumerate() {
        route(r).map_err(|why| route_context(p, index, why))?;
        if p.routes[..index].iter().any(|other| other.id == r.id) {
            return Err("Two routes have the same id.".to_string());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Body, HttpMethod, Webhook};

    fn valid() -> Pipeline {
        Pipeline {
            name: "Alert".into(),
            topic: "orders".into(),
            query: Some("value.status = 'failed'".into()),
            max_per_minute: 60,
            routes: vec![Route {
                id: "r1".into(),
                query: None,
                split: None,
                action: Action::Webhook(Webhook {
                    // Credentials aren't the IR's business: a blank URL is still a valid pipeline.
                    url: String::new(),
                    method: HttpMethod::Post,
                    headers: vec![],
                    body: Body::Template { text: r#"{"order": {{value.id | json}}}"#.into() },
                }),
            }],
        }
    }

    fn with(change: impl FnOnce(&mut Pipeline)) -> String {
        let mut p = valid();
        change(&mut p);
        pipeline(&p).unwrap_err()
    }

    #[test]
    fn accepts_a_complete_pipeline_without_credentials() {
        pipeline(&valid()).unwrap();
    }

    #[test]
    fn rejects_each_bad_field() {
        assert!(with(|p| p.name = "  ".into()).contains("name"));
        assert!(with(|p| p.topic = String::new()).contains("topic"));
        assert!(with(|p| p.max_per_minute = 0).contains("rate limit"));
        assert!(with(|p| p.max_per_minute = MAX_PER_MINUTE + 1).contains("rate limit"));
        assert!(with(|p| p.query = Some("value.x =".into())).contains("filter"));
        assert!(with(|p| p.routes[0].split = Some("item".into())).contains("Requests per item"));
        assert!(with(|p| p.routes[0].query = Some("value.x =".into())).contains("filter"));
        assert!(with(|p| p.routes.clear()).contains("routes"));
    }

    #[test]
    fn names_the_route_at_fault_once_there_are_several() {
        let mut p = valid();
        let mut second = p.routes[0].clone();
        second.id = "r2".into();
        second.query = Some("value.x =".into());
        p.routes.push(second);
        assert!(pipeline(&p).unwrap_err().starts_with("Route 2: "));

        p.routes[1] = p.routes[0].clone();
        assert!(pipeline(&p).unwrap_err().contains("same id"));
    }
}

//! Decides which routes a message takes and what each one sends. The live engine and a replay
//! both go through here, so a replay shows exactly what the pipeline would have done.

use kui_mql::{Query, Record};

use crate::body::{self, Bodies};
use crate::model::{Pipeline, Route};
use crate::template::Event;

/// A pipeline's filters, parsed once.
pub struct Router {
    query: Option<Query>,
    routes: Vec<Option<Query>>,
}

/// What one route made of a message: its bodies, or why they couldn't be built.
pub struct RouteRun {
    /// The route's position in `Pipeline::routes`.
    pub route: usize,
    pub bodies: Result<Bodies, String>,
}

fn parse(query: Option<&str>) -> Result<Option<Query>, String> {
    match query.map(str::trim).filter(|q| !q.is_empty()) {
        Some(q) => Query::parse(q).map(Some).map_err(|e| e.to_string()),
        None => Ok(None),
    }
}

impl Router {
    pub fn new(pipeline: &Pipeline) -> Result<Self, String> {
        let query = parse(pipeline.query.as_deref()).map_err(|e| format!("Invalid filter: {e}"))?;
        let routes = pipeline
            .routes
            .iter()
            .map(|r| parse(r.query.as_deref()).map_err(|e| format!("Invalid route filter: {e}")))
            .collect::<Result<_, _>>()?;
        Ok(Self { query, routes })
    }

    /// Whether the message passes the pipeline's own filter. The live engine filters while
    /// reading the topic, so only a replay needs this.
    pub fn accepts<R: Record + ?Sized>(&self, record: &R) -> bool {
        self.query.as_ref().is_none_or(|q| q.matches(record))
    }

    /// Every route whose filter the message matches, in order, with what it would send.
    pub fn route<R: Record + ?Sized>(&self, pipeline: &Pipeline, record: &R, event: &Event<'_>) -> Vec<RouteRun> {
        pipeline
            .routes
            .iter()
            .zip(&self.routes)
            .enumerate()
            .filter(|(_, (_, filter))| filter.as_ref().is_none_or(|q| q.matches(record)))
            .map(|(index, (route, _))| RouteRun { route: index, bodies: bodies(pipeline, route, event) })
            .collect()
    }
}

/// What `route` sends for `event`, ignoring its filter.
pub fn bodies(pipeline: &Pipeline, route: &Route, event: &Event<'_>) -> Result<Bodies, String> {
    body::render_all(route.action.body(), &pipeline.name, route.split.as_deref(), event)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Action, Body, HttpMethod, Webhook};
    use crate::replay::ReplayMessage;

    fn route(id: &str, query: Option<&str>, text: &str) -> Route {
        Route {
            id: id.into(),
            query: query.map(Into::into),
            split: None,
            action: Action::Webhook(Webhook {
                url: "https://example.com".into(),
                method: HttpMethod::Post,
                headers: vec![],
                body: Body::Template { text: text.into() },
            }),
        }
    }

    fn pipeline(query: Option<&str>, routes: Vec<Route>) -> Pipeline {
        Pipeline { name: "p".into(), topic: "orders".into(), query: query.map(Into::into), max_per_minute: 60, routes }
    }

    #[test]
    fn only_matching_routes_run_and_the_pipeline_filter_is_separate() {
        let p = pipeline(
            Some("value.id > 1"),
            vec![route("all", None, "all:{{value.id}}"), route("failed", Some("value.status = 'failed'"), "f")],
        );
        let router = Router::new(&p).unwrap();
        let paid = ReplayMessage::of_value(r#"{"id":1,"status":"paid"}"#);
        let failed = ReplayMessage::of_value(r#"{"id":2,"status":"failed"}"#);

        assert!(!router.accepts(&paid) && router.accepts(&failed));
        let runs = router.route(&p, &paid, &paid.event("orders"));
        assert_eq!(runs.iter().map(|r| r.route).collect::<Vec<_>>(), [0]);
        assert_eq!(runs[0].bodies.as_ref().unwrap().bodies, ["all:1"]);
        assert_eq!(router.route(&p, &failed, &failed.event("orders")).len(), 2);
    }

    #[test]
    fn a_bad_filter_is_reported_once_up_front() {
        assert!(Router::new(&pipeline(Some("value.x ="), vec![])).err().unwrap().starts_with("Invalid filter"));
        let bad_route = pipeline(None, vec![route("r", Some("value.x ="), "")]);
        assert!(Router::new(&bad_route).err().unwrap().starts_with("Invalid route filter"));
    }
}

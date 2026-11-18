//! Checks an automation from the UI. The webview isn't a trust boundary, so everything is
//! checked again here, and a message never repeats a URL or header value.
//!
//! The pipeline itself is checked by `kui_pipeline::validate`; this adds what makes it sendable
//! from this app: a webhook URL and headers reqwest accepts.

use kui_pipeline::validate::route_context;

use super::model::{Action, Automation, Pipeline};
use super::webhook;
use crate::error::{Error, Result};

/// The pipeline is well formed, though its webhooks may not be filled in yet (a dry run, or a
/// pipeline just opened from a file).
pub fn pipeline(p: &Pipeline) -> Result<()> {
    kui_pipeline::validate::pipeline(p).map_err(Error::msg)
}

/// The automation can run: a well-formed pipeline whose every webhook can be sent.
pub fn automation(a: &Automation) -> Result<()> {
    pipeline(&a.pipeline)?;
    for (index, route) in a.pipeline.routes.iter().enumerate() {
        let sendable = match &route.action {
            Action::Webhook(w) => webhook::parse_url(&w.url).and_then(|_| webhook::build_headers(w).map(|_| ())),
        };
        sendable.map_err(|why| Error::msg(route_context(&a.pipeline, index, why)))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::features::automations::model::{Body, HttpMethod, Route, Webhook, WebhookHeader};

    fn valid() -> Automation {
        Automation {
            id: String::new(),
            enabled: true,
            cluster_id: "c".into(),
            pipeline: Pipeline {
                name: "Alert".into(),
                topic: "orders".into(),
                query: None,
                max_per_minute: 60,
                routes: vec![Route {
                    id: "r1".into(),
                    query: None,
                    split: None,
                    action: Action::Webhook(Webhook {
                        url: "https://hooks.example.com/SECRET".into(),
                        method: HttpMethod::Post,
                        headers: vec![WebhookHeader { name: "Authorization".into(), value: "Bearer SECRET".into() }],
                        body: Body::Envelope,
                    }),
                }],
            },
        }
    }

    fn webhook(a: &mut Automation, route: usize) -> &mut Webhook {
        let Action::Webhook(w) = &mut a.pipeline.routes[route].action;
        w
    }

    #[test]
    fn accepts_a_complete_automation_and_checks_the_pipeline_too() {
        automation(&valid()).unwrap();
        let mut a = valid();
        a.pipeline.topic.clear();
        assert!(automation(&a).unwrap_err().to_string().contains("topic"));
    }

    #[test]
    fn rejects_unsendable_webhooks_with_a_message_that_leaks_nothing() {
        for change in
            [(|a: &mut Automation| webhook(a, 0).url = "ftp://SECRET.example.com".into()) as fn(&mut Automation), |a| {
                webhook(a, 0).headers[0].value = "bad\nSECRET".into()
            }]
        {
            let mut a = valid();
            change(&mut a);
            let message = automation(&a).unwrap_err().to_string();
            assert!(!message.contains("SECRET"), "the error repeats a webhook credential");
        }
    }

    #[test]
    fn a_dry_run_accepts_a_pipeline_whose_webhook_is_not_filled_in_yet() {
        let mut a = valid();
        webhook(&mut a, 0).url.clear();
        assert!(automation(&a).is_err());
        pipeline(&a.pipeline).unwrap();
    }

    #[test]
    fn names_the_route_whose_webhook_is_unsendable() {
        let mut a = valid();
        let mut second = a.pipeline.routes[0].clone();
        second.id = "r2".into();
        a.pipeline.routes.push(second);
        webhook(&mut a, 1).url = "nope".into();
        assert!(automation(&a).unwrap_err().to_string().starts_with("Route 2: "));
    }
}

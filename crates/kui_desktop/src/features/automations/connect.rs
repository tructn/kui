//! Publishes a pipeline's connectors to a Kafka Connect cluster through its REST API. Nothing
//! here may put a webhook URL, header value or the Connect password into an error: the server's
//! messages are redacted before they reach the UI.

use std::fmt;

use reqwest::{Client, StatusCode, Url};
use serde::{Deserialize, Serialize};

use kui_pipeline::export::kafka_connect::{CONNECTOR_CLASS, Connector};
use kui_pipeline::export::redact;

use super::webhook::describe;

/// The longest part of a server's error message passed on to the UI.
const MAX_SERVER_MESSAGE: usize = 500;

/// Where to publish. Nothing about it is saved: the password is only held for the request.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectTarget {
    pub url: String,
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default)]
    pub password: Option<String>,
}

impl fmt::Debug for ConnectTarget {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ConnectTarget").finish_non_exhaustive()
    }
}

impl ConnectTarget {
    fn secrets(&self) -> Vec<&str> {
        self.password.iter().map(String::as_str).collect()
    }
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Published {
    pub name: String,
    /// False when a connector of that name was updated.
    pub created: bool,
}

pub fn parse_url(url: &str) -> Result<Url, String> {
    let url = Url::parse(url.trim()).map_err(|_| "The Kafka Connect URL isn't a valid URL.".to_string())?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err("The Kafka Connect URL must start with http:// or https://.".to_string());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("Put the Kafka Connect user name and password in their own fields, not in the URL.".to_string());
    }
    Ok(url)
}

fn endpoint(base: &Url, path: &str) -> String {
    format!("{}/{path}", base.as_str().trim_end_matches('/'))
}

/// The message in a Connect error body (`{"error_code": 400, "message": "..."}`), redacted and cut.
fn server_message(body: &str, secrets: &[&str]) -> String {
    #[derive(Deserialize)]
    struct ConnectError {
        message: Option<String>,
    }
    let message = serde_json::from_str::<ConnectError>(body).ok().and_then(|e| e.message).unwrap_or_default();
    let message = redact(message.trim(), secrets);
    match message.char_indices().nth(MAX_SERVER_MESSAGE) {
        Some((end, _)) => format!("{}…", &message[..end]),
        None => message,
    }
}

fn refused(status: StatusCode, body: &str, secrets: &[&str]) -> String {
    if status == StatusCode::UNAUTHORIZED || status == StatusCode::FORBIDDEN {
        return format!("Kafka Connect refused the user name or password ({status}).");
    }
    match server_message(body, secrets) {
        message if message.is_empty() => format!("Kafka Connect answered {status}."),
        message => format!("Kafka Connect answered {status}: {message}"),
    }
}

/// Checks the HTTP Sink plugin is installed, then creates or updates each connector.
/// `secrets` are the pipeline's credentials, hidden from any error the server sends back.
pub async fn publish(
    client: &Client,
    target: &ConnectTarget,
    connectors: &[Connector],
    secrets: &[&str],
) -> Result<Vec<Published>, String> {
    let base = parse_url(&target.url)?;
    let secrets: Vec<&str> = secrets.iter().copied().chain(target.secrets()).collect();
    let authorize = |request: reqwest::RequestBuilder| match target.username.as_deref().filter(|u| !u.is_empty()) {
        Some(user) => request.basic_auth(user, target.password.as_deref()),
        None => request,
    };

    let response = authorize(client.get(endpoint(&base, "connector-plugins"))).send().await.map_err(describe)?;
    let status = response.status();
    let body = response.text().await.map_err(describe)?;
    if !status.is_success() {
        return Err(refused(status, &body, &secrets));
    }
    #[derive(Deserialize)]
    struct Plugin {
        class: String,
    }
    let plugins: Vec<Plugin> =
        serde_json::from_str(&body).map_err(|_| "That URL doesn't answer like Kafka Connect.".to_string())?;
    if !plugins.iter().any(|p| p.class == CONNECTOR_CLASS) {
        return Err("The Confluent HTTP Sink connector isn't installed on this Kafka Connect cluster. \
                    Install confluentinc/kafka-connect-http on the workers and restart them."
            .to_string());
    }

    let mut published = Vec::new();
    for connector in connectors {
        let url = endpoint(&base, &format!("connectors/{}/config", connector.name));
        let response = authorize(client.put(url).json(&connector.config))
            .send()
            .await
            .map_err(|e| partly(&published, describe(e)))?;
        let status = response.status();
        if status.is_success() {
            published.push(Published { name: connector.name.clone(), created: status == StatusCode::CREATED });
        } else {
            let body = response.text().await.unwrap_or_default();
            let why = format!("\"{}\": {}", connector.name, refused(status, &body, &secrets));
            return Err(partly(&published, why));
        }
    }
    Ok(published)
}

/// An error that also says which connectors were already published, since they stay running.
fn partly(published: &[Published], why: String) -> String {
    match published.len() {
        0 => why,
        n => format!("{why} ({n} connector{} published before this.)", if n == 1 { " was" } else { "s were" }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    use super::super::webhook::client;

    #[test]
    fn only_http_urls_without_credentials_are_accepted() {
        assert!(parse_url("http://localhost:8083").is_ok());
        assert!(parse_url("https://connect.example.com/api/").is_ok());
        for bad in ["", "localhost:8083", "ftp://connect", "https://admin:SECRET@connect.example.com"] {
            let err = parse_url(bad).unwrap_err();
            assert!(!err.contains("SECRET"), "the error repeats the password");
        }
    }

    #[test]
    fn server_messages_are_redacted_and_cut() {
        let body = r#"{"error_code":400,"message":"Invalid value https://h/SECRET for http.api.url"}"#;
        assert_eq!(server_message(body, &["https://h/SECRET"]), "Invalid value <hidden> for http.api.url");
        let long = format!(r#"{{"message":"{}"}}"#, "x".repeat(MAX_SERVER_MESSAGE + 10));
        assert_eq!(server_message(&long, &[]).chars().count(), MAX_SERVER_MESSAGE + 1);
        assert_eq!(refused(StatusCode::BAD_GATEWAY, "<html>", &[]), "Kafka Connect answered 502 Bad Gateway.");
    }

    /// Answers each connection with the next canned response and returns the raw requests it saw.
    fn serve(responses: Vec<String>) -> (String, std::thread::JoinHandle<Vec<String>>) {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let server = std::thread::spawn(move || {
            let mut seen = Vec::new();
            for response in responses {
                let (mut stream, _) = listener.accept().unwrap();
                let mut buf = vec![0u8; 16 * 1024];
                let n = stream.read(&mut buf).unwrap();
                seen.push(String::from_utf8_lossy(&buf[..n]).into_owned());
                stream.write_all(response.as_bytes()).unwrap();
            }
            seen
        });
        (url, server)
    }

    fn answer(status: &str, body: &str) -> String {
        format!(
            "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        )
    }

    fn plugins() -> String {
        answer("200 OK", &format!(r#"[{{"class":"{CONNECTOR_CLASS}","type":"sink"}}]"#))
    }

    fn connector(name: &str) -> Connector {
        let config = BTreeMap::from([("http.api.url".to_string(), "https://h/SECRET".to_string())]);
        Connector { name: name.into(), config }
    }

    fn target(url: String) -> ConnectTarget {
        ConnectTarget { url, username: Some("admin".into()), password: Some("PASSWORD".into()) }
    }

    #[tokio::test]
    async fn creates_or_updates_each_connector_with_basic_auth() {
        let (url, server) = serve(vec![plugins(), answer("201 Created", "{}"), answer("200 OK", "{}")]);
        let published =
            publish(&client().unwrap(), &target(url), &[connector("kui-a"), connector("kui-b")], &[]).await.unwrap();

        assert_eq!(
            published,
            [Published { name: "kui-a".into(), created: true }, Published { name: "kui-b".into(), created: false }]
        );
        let requests = server.join().unwrap();
        assert!(requests[0].starts_with("GET /connector-plugins"), "{}", requests[0].lines().next().unwrap_or(""));
        assert!(requests[1].starts_with("PUT /connectors/kui-a/config"));
        // "admin:PASSWORD" in base64.
        assert!(requests[1].contains("authorization: Basic YWRtaW46UEFTU1dPUkQ="));
        assert!(requests[1].ends_with(r#"{"http.api.url":"https://h/SECRET"}"#));
    }

    #[tokio::test]
    async fn a_missing_plugin_is_explained_before_anything_is_created() {
        let (url, server) = serve(vec![answer("200 OK", r#"[{"class":"other.Sink"}]"#)]);
        let err = publish(&client().unwrap(), &target(url), &[connector("kui-a")], &[]).await.unwrap_err();
        assert!(err.contains("HTTP Sink connector isn't installed"), "{err}");
        assert_eq!(server.join().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn a_refusal_names_the_connector_counts_the_published_ones_and_leaks_nothing() {
        let refusal = r#"{"error_code":400,"message":"Bad url https://h/SECRET, auth PASSWORD"}"#;
        let (url, _) = serve(vec![plugins(), answer("201 Created", "{}"), answer("400 Bad Request", refusal)]);
        let err =
            publish(&client().unwrap(), &target(url), &[connector("kui-a"), connector("kui-b")], &["https://h/SECRET"])
                .await
                .unwrap_err();
        // No `{err}` in these messages: a failed redaction would print the credential.
        assert!(err.starts_with("\"kui-b\": Kafka Connect answered 400 Bad Request: Bad url <hidden>"));
        assert!(err.ends_with("(1 connector was published before this.)"));
        assert!(!err.contains("SECRET") && !err.contains("PASSWORD"), "the error leaks a credential");
    }

    #[tokio::test]
    async fn wrong_credentials_are_reported_plainly() {
        let (url, _) = serve(vec![answer("401 Unauthorized", "")]);
        let err = publish(&client().unwrap(), &target(url), &[], &[]).await.unwrap_err();
        assert_eq!(err, "Kafka Connect refused the user name or password (401 Unauthorized).");
    }

    /// Reads one HTTP request from `stream` (headers and a `Content-Length` body) and answers 200.
    fn take_request(stream: &mut std::net::TcpStream) -> String {
        use std::io::{Read, Write};
        let mut raw = Vec::new();
        let mut buf = [0u8; 8192];
        loop {
            let n = stream.read(&mut buf).unwrap();
            raw.extend_from_slice(&buf[..n]);
            let text = String::from_utf8_lossy(&raw).to_string();
            if let Some((head, body)) = text.split_once("\r\n\r\n") {
                let length = head
                    .lines()
                    .find_map(|l| l.to_ascii_lowercase().strip_prefix("content-length:").map(|v| v.trim().to_string()))
                    .and_then(|v| v.parse::<usize>().ok())
                    .unwrap_or(0);
                if body.len() >= length || n == 0 {
                    stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").unwrap();
                    return body.to_string();
                }
            }
        }
    }

    /// Publishes a mapping pipeline to a real Kafka Connect and checks the webhook gets exactly the
    /// body KUI's own engine would send for the same message.
    ///
    ///   bun run kafka:up && bun run kafka:connect
    ///   cargo test -p kui_desktop -- --ignored kafka_connect_sends_what_kui_would
    ///
    /// Override with `KUI_TEST_BOOTSTRAP`, `KUI_TEST_CONNECT`, `KUI_TEST_CONNECT_BOOTSTRAP` (the broker
    /// as the workers see it) and `KUI_TEST_WEBHOOK_HOST` (this machine as the workers see it).
    #[tokio::test]
    #[ignore = "needs Kafka and Kafka Connect with the HTTP Sink (bun run kafka:connect)"]
    async fn kafka_connect_sends_what_kui_would() {
        use std::time::Duration;

        use kui_kafka::{ClusterConfig, KafkaClients};
        use kui_pipeline::export::kafka_connect::{ConnectOptions, compile};
        use kui_pipeline::model::{
            Action, Body, FieldMapping, HttpMethod, Pipeline, Route, Source, Transform, Webhook,
        };
        use kui_pipeline::replay::ReplayMessage;
        use kui_pipeline::router;

        use crate::features::messages::model::ProduceRequest;
        use crate::features::topics::model::NewTopicRequest;
        use crate::features::{messages, topics};

        let env = |name: &str, default: &str| std::env::var(name).unwrap_or_else(|_| default.to_string());
        let cluster: ClusterConfig = serde_json::from_value(serde_json::json!({
            "id": "test", "name": "test", "bootstrapServers": env("KUI_TEST_BOOTSTRAP", "localhost:9092"),
        }))
        .unwrap();
        let clients = KafkaClients::connect(cluster).unwrap();
        let topic = format!("kui-it-connect-{}", uuid::Uuid::new_v4());
        let request = NewTopicRequest { name: topic.clone(), partitions: 1, replication_factor: 1, configs: [].into() };
        topics::service::create(&clients, &request).await.unwrap();
        let value = r#"{"id":7,"customer":{"name":"Ada"},"total":"12.5","secret":"not sent"}"#;
        let produce = ProduceRequest {
            topic: topic.clone(),
            partition: Some(0),
            key: Some("k".into()),
            value: Some(value.into()),
            headers: vec![],
        };
        messages::service::produce(&clients, &produce).await.unwrap();

        // The workers run in Docker, so the webhook listens on every interface.
        let listener = std::net::TcpListener::bind("0.0.0.0:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let field = |target: &str, path: &str, transform| FieldMapping {
            target: target.into(),
            source: Source::Field { path: path.into() },
            transform,
            default: None,
        };
        let pipeline = Pipeline {
            name: format!("Parity {topic}"),
            topic: topic.clone(),
            query: None,
            max_per_minute: 60,
            routes: vec![Route {
                id: "route-1".into(),
                query: None,
                split: None,
                action: Action::Webhook(Webhook {
                    url: format!("http://{}:{port}/hook", env("KUI_TEST_WEBHOOK_HOST", "host.docker.internal")),
                    method: HttpMethod::Post,
                    headers: vec![],
                    body: Body::Mapping {
                        fields: vec![
                            field("id", "value.id", None),
                            field("customer", "value.customer.name", None),
                            field("total", "value.total", Some(Transform::ToNumber)),
                            field("from", "topic", None),
                        ],
                    },
                }),
            }],
        };
        let options = ConnectOptions {
            name_prefix: "kui-it".into(),
            bootstrap_servers: env("KUI_TEST_CONNECT_BOOTSTRAP", "kafka:29092"),
            replication_factor: 1,
            properties: Default::default(),
        };
        let plan = compile(&pipeline, &options);
        assert!(plan.blockers.is_empty(), "{:?}", plan.blockers);
        let target =
            ConnectTarget { url: env("KUI_TEST_CONNECT", "http://localhost:8083"), username: None, password: None };
        let published = publish(&client().unwrap(), &target, &plan.connectors, &[]).await.unwrap();

        let (sent, received) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let _ = sent.send(take_request(&mut stream));
        });
        let body = received.recv_timeout(Duration::from_secs(120));

        let base = parse_url(&target.url).unwrap();
        let _ = client().unwrap().delete(endpoint(&base, &format!("connectors/{}", published[0].name))).send().await;
        let _ = topics::service::delete(&clients, std::slice::from_ref(&topic)).await;

        let body = body.expect("the connector never called the webhook");
        let message = ReplayMessage { value: Some(value.into()), ..ReplayMessage::default() };
        let native = router::bodies(&pipeline, &pipeline.routes[0], &message.event(&topic)).unwrap();
        let on_connect: serde_json::Value = serde_json::from_str(&body).unwrap();
        let in_kui: serde_json::Value = serde_json::from_str(&native.bodies[0]).unwrap();
        assert_eq!(on_connect, in_kui);
    }
}

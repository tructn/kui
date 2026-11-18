//! Sends a webhook. Nothing here may put the URL or a header value into an error:
//! both are usually the credential.

use std::sync::Arc;
use std::time::Duration;

use reqwest::header::{CONTENT_TYPE, HeaderMap, HeaderName, HeaderValue};
use reqwest::{Client, StatusCode, Url};

use super::model::{Webhook, as_reqwest};
use crate::error::Result;

const TIMEOUT: Duration = Duration::from_secs(10);
const RETRY_AFTER: Duration = Duration::from_secs(1);
const ATTEMPTS: usize = 2;

pub fn client() -> Result<Client> {
    // The updater installs the same provider; whoever gets there first wins, and either way it's ring.
    let _ = rustls::crypto::ring::default_provider().install_default();
    Ok(Client::builder()
        .user_agent(concat!("KUI/", env!("CARGO_PKG_VERSION")))
        .timeout(TIMEOUT)
        // A redirect could carry the request, and its credentials, to another host.
        .redirect(reqwest::redirect::Policy::none())
        .build()?)
}

/// Sends one webhook and waits for the answer. `Engine` takes this as a function so tests can
/// swap in a fake.
pub type Sender = dyn Fn(&Webhook, String) -> std::result::Result<u16, String> + Send + Sync;

/// The real sender. It blocks, so call it from a worker thread, never from async code.
pub fn http_sender() -> Result<Arc<Sender>> {
    let client = client()?;
    Ok(Arc::new(move |webhook: &Webhook, body: String| tauri::async_runtime::block_on(send(&client, webhook, body))))
}

pub fn parse_url(url: &str) -> std::result::Result<Url, String> {
    let url = Url::parse(url.trim()).map_err(|_| "The webhook URL isn't a valid URL.".to_string())?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err("The webhook URL must start with http:// or https://.".to_string());
    }
    Ok(url)
}

/// The headers to send. A body is JSON unless a `Content-Type` header says otherwise.
pub fn build_headers(webhook: &Webhook) -> std::result::Result<HeaderMap, String> {
    let mut headers = HeaderMap::new();
    for header in &webhook.headers {
        let name = HeaderName::from_bytes(header.name.trim().as_bytes())
            .map_err(|_| format!("\"{}\" isn't a valid header name.", header.name.trim()))?;
        let mut value = HeaderValue::from_str(&header.value)
            .map_err(|_| format!("The value of the header \"{}\" has characters a header can't hold.", name))?;
        value.set_sensitive(true);
        headers.append(name, value);
    }
    if !headers.contains_key(CONTENT_TYPE) {
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    }
    Ok(headers)
}

enum Attempt {
    Done(u16),
    Retry(String),
    Fail(String),
}

/// Sends `body`, trying again once after a network error, a 429 or a 5xx. Returns the status
/// code of a 2xx answer, or why it failed.
pub async fn send(client: &Client, webhook: &Webhook, body: String) -> std::result::Result<u16, String> {
    let url = parse_url(&webhook.url)?;
    let headers = build_headers(webhook)?;
    let mut last = String::new();
    for attempt in 0..ATTEMPTS {
        if attempt > 0 {
            tokio::time::sleep(RETRY_AFTER).await;
        }
        let request =
            client.request(as_reqwest(webhook.method), url.clone()).headers(headers.clone()).body(body.clone());
        match request.send().await {
            Ok(response) => match classify(response.status()) {
                Attempt::Done(code) => return Ok(code),
                Attempt::Retry(why) => last = why,
                Attempt::Fail(why) => return Err(why),
            },
            Err(e) => last = describe(e),
        }
    }
    Err(last)
}

fn classify(status: StatusCode) -> Attempt {
    if status.is_success() {
        Attempt::Done(status.as_u16())
    } else if status == StatusCode::TOO_MANY_REQUESTS || status.is_server_error() {
        Attempt::Retry(format!("The server answered {status}"))
    } else {
        Attempt::Fail(format!("The server answered {status}"))
    }
}

pub fn describe(error: reqwest::Error) -> String {
    let error = error.without_url();
    if error.is_timeout() {
        format!("The server didn't answer within {} seconds", TIMEOUT.as_secs())
    } else if error.is_connect() {
        "Could not connect to the server".to_string()
    } else {
        "The request failed".to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::features::automations::model::{Body, HttpMethod, WebhookHeader};

    fn webhook(headers: Vec<(&str, &str)>) -> Webhook {
        Webhook {
            url: "https://hooks.example.com/T000/SECRET".into(),
            method: HttpMethod::Post,
            headers: headers.into_iter().map(|(n, v)| WebhookHeader { name: n.into(), value: v.into() }).collect(),
            body: Body::Envelope,
        }
    }

    #[test]
    fn only_http_urls_with_a_host_are_accepted() {
        assert!(parse_url("https://example.com/hook?token=1").is_ok());
        assert!(parse_url("http://localhost:8080/x").is_ok());
        for bad in ["", "example.com/hook", "file:///etc/passwd", "ftp://example.com", "javascript:alert(1)"] {
            assert!(parse_url(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn json_is_the_default_content_type_but_can_be_overridden() {
        let default = build_headers(&webhook(vec![("Authorization", "Bearer t")])).unwrap();
        assert_eq!(default[CONTENT_TYPE], "application/json");
        assert!(default["authorization"].is_sensitive());

        let custom = build_headers(&webhook(vec![("content-type", "text/plain")])).unwrap();
        assert_eq!(custom[CONTENT_TYPE], "text/plain");
    }

    #[test]
    fn bad_headers_are_reported_without_their_value() {
        let err = build_headers(&webhook(vec![("X-Token", "line\nbreak-SECRET")])).unwrap_err();
        assert!(err.contains("x-token") && !err.contains("SECRET"), "{err}");
        assert!(build_headers(&webhook(vec![("bad name", "v")])).is_err());
    }

    #[test]
    fn only_server_errors_and_throttling_are_retried() {
        assert!(matches!(classify(StatusCode::OK), Attempt::Done(200)));
        assert!(matches!(classify(StatusCode::NO_CONTENT), Attempt::Done(204)));
        assert!(matches!(classify(StatusCode::BAD_GATEWAY), Attempt::Retry(_)));
        assert!(matches!(classify(StatusCode::TOO_MANY_REQUESTS), Attempt::Retry(_)));
        assert!(matches!(classify(StatusCode::NOT_FOUND), Attempt::Fail(_)));
        assert!(matches!(classify(StatusCode::FOUND), Attempt::Fail(_)));
    }

    /// Answers each connection with the next canned response and returns the raw requests it saw.
    fn serve(responses: Vec<&'static str>) -> (String, std::thread::JoinHandle<Vec<String>>) {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/hook", listener.local_addr().unwrap());
        let server = std::thread::spawn(move || {
            let mut seen = Vec::new();
            for response in responses {
                let (mut stream, _) = listener.accept().unwrap();
                let mut buf = vec![0u8; 8192];
                let n = stream.read(&mut buf).unwrap();
                seen.push(String::from_utf8_lossy(&buf[..n]).into_owned());
                stream.write_all(response.as_bytes()).unwrap();
            }
            seen
        });
        (url, server)
    }

    const OK: &str = "HTTP/1.1 204 No Content\r\nConnection: close\r\n\r\n";

    #[tokio::test]
    async fn sends_the_method_headers_and_body() {
        let (url, server) = serve(vec![OK]);
        let mut hook = webhook(vec![("X-Api-Key", "k-123")]);
        hook.url = url;
        hook.method = HttpMethod::Put;

        let status = send(&client().unwrap(), &hook, r#"{"a":1}"#.into()).await.unwrap();

        let request = server.join().unwrap().remove(0).to_lowercase();
        assert_eq!(status, 204);
        assert!(request.starts_with("put /hook"), "{request}");
        assert!(
            request.contains("x-api-key: k-123") && request.contains("content-type: application/json"),
            "{request}"
        );
        assert!(request.ends_with(r#"{"a":1}"#), "{request}");
    }

    #[tokio::test]
    async fn retries_once_after_a_server_error_and_never_follows_a_redirect() {
        let (url, server) = serve(vec!["HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n", OK]);
        let mut hook = webhook(vec![]);
        hook.url = url;
        assert_eq!(send(&client().unwrap(), &hook, String::new()).await, Ok(204));
        assert_eq!(server.join().unwrap().len(), 2);

        let (url, server) =
            serve(vec!["HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:1/elsewhere\r\nConnection: close\r\n\r\n"]);
        hook.url = url;
        let err = send(&client().unwrap(), &hook, String::new()).await.unwrap_err();
        assert_eq!(err, "The server answered 302 Found");
        assert_eq!(server.join().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn a_refused_connection_is_reported_without_the_url() {
        let mut hook = webhook(vec![]);
        hook.url = "http://127.0.0.1:1/SECRET-PATH".into();
        let err = send(&client().unwrap(), &hook, String::new()).await.unwrap_err();
        assert!(!err.contains("SECRET") && !err.contains("127.0.0.1"), "{err}");
    }
}

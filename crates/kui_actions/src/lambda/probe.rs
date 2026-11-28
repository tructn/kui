use std::time::Duration;

use reqwest::{Client, Url};

use super::client::{endpoint_url, invocation_url, not_running};
use crate::model::{EndpointCheck, LambdaRuntime};

/// Probing with a name no template defines: SAM answers with ResourceNotFound
/// without starting a container, which tells it apart from any other server.
const PROBE_FUNCTION: &str = "kui-endpoint-check";
const PROBE_TIMEOUT: Duration = Duration::from_secs(5);

pub async fn check_endpoint(client: &Client, endpoint: &Url, runtime: LambdaRuntime) -> EndpointCheck {
    match runtime {
        LambdaRuntime::Sam => check_sam(client, endpoint).await,
        LambdaRuntime::TestTool => check_test_tool(client, endpoint).await,
    }
}

async fn check_sam(client: &Client, endpoint: &Url) -> EndpointCheck {
    let url = match invocation_url(endpoint, PROBE_FUNCTION) {
        Ok(url) => url,
        Err(e) => return EndpointCheck::Unexpected { message: e.to_string() },
    };
    let response = match client.post(url.clone()).body("{}").timeout(PROBE_TIMEOUT).send().await {
        Ok(response) => response,
        Err(e) => return failed_probe(e, &url, LambdaRuntime::Sam),
    };
    let not_found = response.status().as_u16() == 404
        || response.headers().get("x-amzn-errortype").is_some_and(|v| v.as_bytes() == b"ResourceNotFound");
    if not_found { EndpointCheck::Ready } else { unexpected(response.status().as_u16(), LambdaRuntime::Sam) }
}

/// The Test Tool accepts an invocation for any name and holds it until a
/// function asks for it, so SAM's probe would leave an event queued and hang.
/// It has a health check instead.
async fn check_test_tool(client: &Client, endpoint: &Url) -> EndpointCheck {
    let url = match endpoint_url(endpoint, &["lambda-runtime-api", "healthcheck"]) {
        Ok(url) => url,
        Err(e) => return EndpointCheck::Unexpected { message: e.to_string() },
    };
    let response = match client.get(url.clone()).timeout(PROBE_TIMEOUT).send().await {
        Ok(response) => response,
        Err(e) => return failed_probe(e, &url, LambdaRuntime::TestTool),
    };
    let status = response.status().as_u16();
    match response.bytes().await {
        Ok(body) if status == 200 && body.as_ref() == b"health" => EndpointCheck::Ready,
        _ => unexpected(status, LambdaRuntime::TestTool),
    }
}

fn failed_probe(e: reqwest::Error, url: &Url, runtime: LambdaRuntime) -> EndpointCheck {
    if e.is_connect() {
        EndpointCheck::NotRunning { message: not_running(url, runtime) }
    } else if e.is_timeout() {
        EndpointCheck::Unexpected { message: format!("The endpoint didn't answer within {}s", PROBE_TIMEOUT.as_secs()) }
    } else {
        EndpointCheck::Unexpected { message: e.without_url().to_string() }
    }
}

fn unexpected(status: u16, runtime: LambdaRuntime) -> EndpointCheck {
    EndpointCheck::Unexpected {
        message: format!("Something answers there (HTTP {status}), but not like `{}`", runtime.start_command()),
    }
}

#[cfg(test)]
mod tests {
    use super::super::client::client;
    use super::super::test_server::{closed_endpoint, http, serve_once};
    use super::*;

    #[tokio::test]
    async fn reports_a_stopped_endpoint() {
        let endpoint = closed_endpoint().await;
        let check = check_endpoint(&client().unwrap(), &endpoint, LambdaRuntime::Sam).await;
        assert!(
            matches!(check, EndpointCheck::NotRunning { ref message } if message.contains("sam local start-lambda"))
        );
    }

    #[tokio::test]
    async fn recognises_sam_by_its_not_found_answer() {
        let (endpoint, _server) =
            serve_once(http("404 Not Found", "x-amzn-errortype: ResourceNotFound\r\n", "{}")).await;
        assert_eq!(check_endpoint(&client().unwrap(), &endpoint, LambdaRuntime::Sam).await, EndpointCheck::Ready);
        let (endpoint, _server) = serve_once(http("200 OK", "", "hi")).await;
        assert!(matches!(
            check_endpoint(&client().unwrap(), &endpoint, LambdaRuntime::Sam).await,
            EndpointCheck::Unexpected { .. }
        ));
    }

    #[tokio::test]
    async fn recognises_the_test_tool_by_its_health_check() {
        let (endpoint, server) = serve_once(http("200 OK", "", "health")).await;
        assert_eq!(check_endpoint(&client().unwrap(), &endpoint, LambdaRuntime::TestTool).await, EndpointCheck::Ready);
        let request = server.await.unwrap();
        assert!(request.starts_with("GET /lambda-runtime-api/healthcheck "), "never queues an invocation: {request}");

        let (endpoint, _server) = serve_once(http("200 OK", "", "<html>")).await;
        let check = check_endpoint(&client().unwrap(), &endpoint, LambdaRuntime::TestTool).await;
        assert!(matches!(check, EndpointCheck::Unexpected { ref message } if message.contains("lambda-test-tool")));
    }
}

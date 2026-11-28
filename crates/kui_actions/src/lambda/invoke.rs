use std::time::Duration;

use reqwest::{Client, Url};

use super::client::not_running;
use super::response::read_response;
use crate::model::{ExecutionStatus, LambdaRuntime};
use crate::run::Outcome;

/// Where to send an invocation and how long to wait for it.
#[derive(Debug, Clone)]
pub struct Call {
    pub runtime: LambdaRuntime,
    pub url: Url,
    pub function: String,
    pub timeout: Duration,
}

pub async fn invoke(client: &Client, call: &Call, payload: Vec<u8>) -> Outcome {
    let Call { runtime, url, function, timeout } = call;
    let sent = client
        .post(url.clone())
        .header("X-Amz-Invocation-Type", "RequestResponse")
        .header("Content-Type", "application/json")
        .timeout(*timeout)
        .body(payload)
        .send()
        .await;
    let response = match sent {
        Ok(response) => response,
        Err(e) => return transport_error(e, call),
    };
    let status = response.status().as_u16();
    let header = |name: &str| response.headers().get(name).and_then(|v| v.to_str().ok()).map(str::to_string);
    let function_error = header("X-Amz-Function-Error");
    let error_type = header("x-amzn-errortype");
    match response.bytes().await {
        Ok(body) => {
            read_response(*runtime, status, function_error.as_deref(), error_type.as_deref(), body.to_vec(), function)
        }
        Err(e) => transport_error(e, call),
    }
}

fn transport_error(e: reqwest::Error, call: &Call) -> Outcome {
    if e.is_timeout() {
        let hint = call.runtime.no_answer_hint(&call.function);
        return Outcome::unanswered(
            ExecutionStatus::TimedOut,
            format!("No response within {}s. {hint}", call.timeout.as_secs()),
        );
    }
    if e.is_connect() {
        return Outcome::unanswered(ExecutionStatus::Failed, not_running(&call.url, call.runtime));
    }
    let error = format!("The request to {} failed: {}", call.runtime.label(), e.without_url());
    Outcome::unanswered(ExecutionStatus::Failed, error)
}

#[cfg(test)]
mod tests {
    use super::super::client::{client, invocation_url};
    use super::super::test_server::{closed_endpoint, http, serve_once, silent_endpoint};
    use super::*;

    fn call(runtime: LambdaRuntime, endpoint: &Url, function: &str, timeout: Duration) -> Call {
        Call { runtime, url: invocation_url(endpoint, function).unwrap(), function: function.into(), timeout }
    }

    #[tokio::test]
    async fn invokes_over_http() {
        let (endpoint, server) = serve_once(http("200 OK", "", "{\"done\":true}")).await;
        let call = call(LambdaRuntime::Sam, &endpoint, "OrderProcessor", Duration::from_secs(5));
        let out = invoke(&client().unwrap(), &call, b"{\"a\":1}".to_vec()).await;
        assert_eq!(out.status, ExecutionStatus::Succeeded);
        assert_eq!(out.response.as_deref(), Some(&b"{\"done\":true}"[..]));
        let request = server.await.unwrap();
        assert!(request.starts_with("POST /2015-03-31/functions/OrderProcessor/invocations"), "{request}");
        assert!(request.to_ascii_lowercase().contains("x-amz-invocation-type: requestresponse"));
        assert!(request.ends_with("{\"a\":1}"));
    }

    #[tokio::test]
    async fn reads_function_errors_from_the_header() {
        let (endpoint, _server) = serve_once(http(
            "200 OK",
            "X-Amz-Function-Error: Unhandled\r\n",
            r#"{"errorType":"E","errorMessage":"boom"}"#,
        ))
        .await;
        let call = call(LambdaRuntime::TestTool, &endpoint, "Fn", Duration::from_secs(5));
        let out = invoke(&client().unwrap(), &call, b"{}".to_vec()).await;
        assert_eq!(out.status, ExecutionStatus::FunctionError);
        assert_eq!(out.error.as_deref(), Some("E: boom"));
    }

    #[tokio::test]
    async fn times_out_slow_functions() {
        let (endpoint, _server) = silent_endpoint().await;
        let call = call(LambdaRuntime::TestTool, &endpoint, "Slow", Duration::from_millis(200));
        let out = invoke(&client().unwrap(), &call, b"{}".to_vec()).await;
        assert_eq!(out.status, ExecutionStatus::TimedOut);
        assert!(out.retryable);
        let error = out.error.unwrap();
        assert!(error.contains("AWS_LAMBDA_RUNTIME_API ends in /Slow"), "{error}");
    }

    #[tokio::test]
    async fn reports_a_stopped_endpoint() {
        let endpoint = closed_endpoint().await;
        for (runtime, command) in [(LambdaRuntime::Sam, "sam local"), (LambdaRuntime::TestTool, "lambda-test-tool")] {
            let out =
                invoke(&client().unwrap(), &call(runtime, &endpoint, "Fn", Duration::from_secs(2)), b"{}".to_vec())
                    .await;
            assert_eq!(out.status, ExecutionStatus::Failed);
            let error = out.error.unwrap();
            assert!(error.starts_with("Nothing is listening") && error.contains(command), "{error}");
        }
    }
}

//! Invokes the example .NET function through a real AWS Lambda Test Tool. Not
//! run by default; start both first (see `examples/order-lambda`):
//!
//!   dotnet lambda-test-tool start --lambda-emulator-port 5050 --no-launch-window
//!   # run OrderProcessor with AWS_LAMBDA_RUNTIME_API=localhost:5050/OrderProcessor
//!   cargo test -p kui_actions --test invoke_test_tool -- --ignored
//!
//! Override the endpoint with `KUI_TEST_TOOL_URL`.

use std::time::Duration;

use reqwest::Url;

use kui_actions::lambda::{self, Call};
use kui_actions::model::{EndpointCheck, ExecutionStatus, LambdaRuntime};

fn endpoint() -> Url {
    Url::parse(&std::env::var("KUI_TEST_TOOL_URL").unwrap_or("http://localhost:5050".into())).unwrap()
}

fn call(function: &str) -> Call {
    Call {
        runtime: LambdaRuntime::TestTool,
        url: lambda::invocation_url(&endpoint(), function).unwrap(),
        function: function.into(),
        timeout: Duration::from_secs(20),
    }
}

#[tokio::test]
#[ignore = "needs the Lambda Test Tool and the example function running"]
async fn invokes_the_example_function_through_the_test_tool() {
    let client = lambda::client().unwrap();
    assert_eq!(lambda::check_endpoint(&client, &endpoint(), LambdaRuntime::TestTool).await, EndpointCheck::Ready);

    let event = include_bytes!("../../../examples/order-lambda/events/msk-event.json");
    let out = lambda::invoke(&client, &call("OrderProcessor"), event.to_vec()).await;
    assert_eq!(out.status, ExecutionStatus::Succeeded, "{:?}", out.error);
    let response = String::from_utf8(out.response.unwrap()).unwrap();
    assert!(response.contains("\"Decision\""), "{response}");

    // HandleMsk can't read a plain order, so the handler throws.
    let out = lambda::invoke(&client, &call("OrderProcessor"), br#"{"orderId":"o9"}"#.to_vec()).await;
    assert_eq!(out.status, ExecutionStatus::FunctionError);
    assert!(!out.retryable);
}

#[tokio::test]
#[ignore = "needs the Lambda Test Tool running"]
async fn a_function_nobody_runs_times_out_as_retryable() {
    let client = lambda::client().unwrap();
    let mut call = call("KuiNobodyRunsThis");
    call.timeout = Duration::from_secs(1);
    let out = lambda::invoke(&client, &call, b"{}".to_vec()).await;
    assert_eq!(out.status, ExecutionStatus::TimedOut);
    assert!(out.retryable);
    assert!(out.error.unwrap().contains("AWS_LAMBDA_RUNTIME_API ends in /KuiNobodyRunsThis"));
}

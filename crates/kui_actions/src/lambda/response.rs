use serde_json::Value;

use crate::model::{ExecutionStatus, LambdaRuntime};
use crate::run::Outcome;

/// Maps the Invoke API's answer to an outcome.
pub fn read_response(
    runtime: LambdaRuntime,
    status: u16,
    function_error: Option<&str>,
    error_type: Option<&str>,
    body: Vec<u8>,
    function: &str,
) -> Outcome {
    if (200..300).contains(&status) {
        return match function_error {
            None => Outcome { status: ExecutionStatus::Succeeded, response: Some(body), error: None, retryable: false },
            Some(_) => Outcome {
                status: ExecutionStatus::FunctionError,
                error: Some(function_error_text(&body)),
                response: Some(body),
                retryable: false,
            },
        };
    }
    let message = service_message(&body);
    let name = runtime.label();
    let not_found = status == 404 || error_type == Some("ResourceNotFound");
    let error = match (status, error_type) {
        _ if not_found => format!(
            "SAM has no function \"{function}\". Run `sam build`, restart `sam local start-lambda`, \
             and check the name matches the template's logical ID."
        ),
        (400 | 413, _) => {
            format!("{name} rejected the payload{}", message.map(|m| format!(": {m}")).unwrap_or_default())
        }
        _ => format!("{name} answered HTTP {status}{}", message.map(|m| format!(": {m}")).unwrap_or_default()),
    };
    // An unknown function is often one SAM hasn't been restarted with yet.
    Outcome {
        status: ExecutionStatus::Failed,
        response: (!body.is_empty()).then_some(body),
        error: Some(error),
        retryable: not_found,
    }
}

/// `errorType: errorMessage` from a Lambda error body, which every runtime sends.
fn function_error_text(body: &[u8]) -> String {
    let parsed: Option<Value> = serde_json::from_slice(body).ok();
    let field = |name: &str| parsed.as_ref().and_then(|v| v.get(name)).and_then(Value::as_str).map(str::to_string);
    match (field("errorType"), field("errorMessage")) {
        (Some(kind), Some(message)) => format!("{kind}: {message}"),
        (None, Some(message)) => message,
        (Some(kind), None) => kind,
        (None, None) => "The function threw an error".to_string(),
    }
}

fn service_message(body: &[u8]) -> Option<String> {
    let parsed: Value = serde_json::from_slice(body).ok()?;
    ["message", "Message"].iter().find_map(|k| parsed.get(*k)?.as_str().map(str::to_string))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn success_keeps_the_response() {
        let out = read_response(LambdaRuntime::Sam, 200, None, None, b"{\"ok\":true}".to_vec(), "Fn");
        assert_eq!(out.status, ExecutionStatus::Succeeded);
        assert_eq!(out.response.as_deref(), Some(&b"{\"ok\":true}"[..]));
        assert_eq!(out.error, None);
    }

    #[test]
    fn function_errors_show_type_and_message() {
        let body =
            br#"{"errorType":"System.InvalidOperationException","errorMessage":"no total","stackTrace":["at X"]}"#;
        let out = read_response(LambdaRuntime::Sam, 200, Some("Unhandled"), None, body.to_vec(), "Fn");
        assert_eq!(out.status, ExecutionStatus::FunctionError);
        assert_eq!(out.error.as_deref(), Some("System.InvalidOperationException: no total"));
        assert!(out.response.is_some());
        let out = read_response(LambdaRuntime::Sam, 200, Some("Unhandled"), None, b"not json".to_vec(), "Fn");
        assert_eq!(out.error.as_deref(), Some("The function threw an error"));
    }

    #[test]
    fn unknown_functions_name_the_fix() {
        let body =
            br#"{"Type":"User","Message":"Function not found: arn:aws:lambda:us-west-2:012345678901:function:Nope"}"#;
        let out = read_response(LambdaRuntime::Sam, 404, None, Some("ResourceNotFound"), body.to_vec(), "Nope");
        assert_eq!(out.status, ExecutionStatus::Failed);
        assert!(out.retryable);
        let error = out.error.unwrap();
        assert!(error.contains("\"Nope\"") && error.contains("sam build"), "{error}");
    }

    #[test]
    fn other_errors_carry_sams_message() {
        let out = read_response(
            LambdaRuntime::Sam,
            400,
            None,
            None,
            br#"{"message":"Could not parse request body into json"}"#.to_vec(),
            "Fn",
        );
        assert_eq!(out.error.as_deref(), Some("SAM rejected the payload: Could not parse request body into json"));
        assert!(!out.retryable, "the same payload would be rejected again");
        let out = read_response(LambdaRuntime::Sam, 502, None, None, Vec::new(), "Fn");
        assert_eq!(out.error.as_deref(), Some("SAM answered HTTP 502"));
        assert_eq!(out.response, None);
        let out = read_response(LambdaRuntime::TestTool, 413, None, None, b"too big".to_vec(), "Fn");
        assert_eq!(out.error.as_deref(), Some("Lambda Test Tool rejected the payload"));
    }
}

use crate::model::LambdaRuntime;

impl LambdaRuntime {
    /// Its name at the start of a sentence: "SAM rejected the payload".
    pub fn label(self) -> &'static str {
        match self {
            LambdaRuntime::Sam => "SAM",
            LambdaRuntime::TestTool => "Lambda Test Tool",
        }
    }

    pub fn start_command(self) -> &'static str {
        match self {
            LambdaRuntime::Sam => "sam local start-lambda",
            LambdaRuntime::TestTool => "dotnet lambda-test-tool start --lambda-emulator-port 5050",
        }
    }

    /// Why an invocation may get no answer, where the runtimes differ most: SAM
    /// runs the function itself, the Test Tool queues the event until a process
    /// asks for it.
    pub(super) fn no_answer_hint(self, function: &str) -> String {
        match self {
            LambdaRuntime::Sam => "The function may still be running in its container.".to_string(),
            LambdaRuntime::TestTool => format!(
                "The event waits in the Test Tool until a function asks for it: check the function is running \
                 and its AWS_LAMBDA_RUNTIME_API ends in /{function}."
            ),
        }
    }
}

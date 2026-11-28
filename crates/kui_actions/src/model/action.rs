use serde::{Deserialize, Serialize};

/// A saved Action: consume a topic and hand each message to an executor.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Action {
    /// Empty when the UI saves a new Action; the store assigns one.
    #[serde(default)]
    pub id: String,
    pub name: String,
    pub cluster_id: String,
    pub source: Source,
    pub executor: Executor,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    pub topic: String,
    /// KUI joins this group and commits offsets for it.
    pub group_id: String,
    pub start_from: StartFrom,
}

/// Where a group without committed offsets starts. A group with committed
/// offsets always resumes from them, which is what makes Stop/Start resume.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StartFrom {
    Latest,
    Earliest,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Executor {
    LocalLambda(LambdaTarget),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LambdaTarget {
    /// Actions saved before the Test Tool existed are SAM ones.
    #[serde(default)]
    pub runtime: LambdaRuntime,
    /// e.g. `http://127.0.0.1:3001` for SAM, `http://localhost:5050` for the Test Tool.
    pub endpoint: String,
    /// The SAM logical ID, or for the Test Tool the name after the port in the
    /// function's `AWS_LAMBDA_RUNTIME_API`.
    pub function_name: String,
    /// The SAM project the function was discovered in, to discover again later.
    #[serde(default)]
    pub project_dir: Option<String>,
    pub payload: PayloadFormat,
    pub timeout_secs: u32,
    /// Invocations running at once; never more than one per partition.
    pub concurrency: u8,
    /// A person is stepping through the handler: one message at a time, and a
    /// message that didn't get an answer is sent again instead of skipped.
    #[serde(default)]
    pub debug: bool,
}

/// What serves the Lambda Invoke API locally. Both take the same request.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LambdaRuntime {
    /// `sam local start-lambda`: runs the function in Docker.
    #[default]
    Sam,
    /// AWS's .NET Lambda Test Tool: the function runs as a normal process (e.g.
    /// under the Visual Studio debugger) and pulls events from it.
    TestTool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PayloadFormat {
    /// The message value, which must be JSON.
    Raw,
    /// The event AWS Lambda receives from an MSK event source mapping.
    Msk,
}

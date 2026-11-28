//! Invokes functions through the Lambda Invoke API that `sam local start-lambda`
//! and the .NET Lambda Test Tool both serve. It's one HTTP call and neither
//! checks request signatures, so a plain client does the job without the AWS
//! SDK or any AWS credentials.

mod client;
mod invoke;
mod plan;
mod probe;
mod response;
mod runtime;
#[cfg(test)]
mod test_server;

pub use client::{client, invocation_url};
pub use invoke::{Call, invoke};
pub(crate) use plan::{check_target, plan};
pub use probe::check_endpoint;
pub use response::read_response;

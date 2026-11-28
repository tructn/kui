use serde_json::Value;

use super::Parsed;
use crate::model::{ConfiguredName, DiscoveredFunction};

pub(super) fn functions(template: &Value) -> std::result::Result<Parsed, String> {
    let resources = template.get("Resources").and_then(Value::as_object).ok_or("it has no Resources section")?;
    let globals = template.pointer("/Globals/Function");
    let mut functions = Vec::new();
    let mut skipped = Vec::new();
    for (id, resource) in resources {
        let kind = resource.get("Type").and_then(Value::as_str).unwrap_or_default();
        match kind {
            "AWS::Serverless::Function" => functions.push(function(id, kind, resource, globals)),
            "AWS::Lambda::Function" => functions.push(function(id, kind, resource, None)),
            "AWS::Serverless::Application" | "AWS::CloudFormation::Stack" => {
                skipped.push(format!("{id}: nested stacks aren't supported"));
            }
            _ => {}
        }
    }
    Ok((functions, skipped))
}

/// `Globals` applies only to serverless resources, so plain Lambda functions pass `None`.
fn function(id: &str, kind: &str, resource: &Value, globals: Option<&Value>) -> DiscoveredFunction {
    let own = resource.get("Properties");
    let property = |name: &str| own.and_then(|p| p.get(name)).or_else(|| globals.and_then(|g| g.get(name)));
    let text = |name: &str| property(name).and_then(scalar);
    let function_name = match own.and_then(|p| p.get("FunctionName")) {
        None | Some(Value::Null) => ConfiguredName::NotSet,
        Some(value) => scalar(value).map_or(ConfiguredName::Computed, ConfiguredName::Literal),
    };
    let metadata = resource
        .get("Metadata")
        .and_then(Value::as_object)
        .map(|m| m.iter().map(|(k, v)| (k.clone(), scalar(v).unwrap_or_else(|| v.to_string()))).collect())
        .unwrap_or_default();
    DiscoveredFunction {
        logical_id: id.to_string(),
        resource_type: kind.to_string(),
        function_name,
        runtime: text("Runtime"),
        handler: text("Handler"),
        code_uri: text("CodeUri"),
        package_type: text("PackageType"),
        kafka_topics: kafka_topics(own),
        metadata,
    }
}

fn kafka_topics(properties: Option<&Value>) -> Vec<String> {
    let Some(events) = properties.and_then(|p| p.get("Events")).and_then(Value::as_object) else { return Vec::new() };
    events
        .values()
        .filter(|e| matches!(e.get("Type").and_then(Value::as_str), Some("MSK" | "SelfManagedKafka")))
        .filter_map(|e| e.pointer("/Properties/Topics").and_then(Value::as_array))
        .flatten()
        .filter_map(scalar)
        .collect()
}

/// Plain values as text; intrinsics (`{"Ref": ..}`, `{"Fn::Sub": ..}`) and lists are `None`.
pub(super) fn scalar(value: &Value) -> Option<String> {
    match value {
        Value::String(s) => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        Value::Bool(b) => Some(b.to_string()),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::super::fixtures::{TEMPLATE, by_id};
    use super::super::parse;
    use super::*;

    #[test]
    fn finds_serverless_and_plain_lambda_functions() {
        let (functions, skipped) = parse(TEMPLATE, false).unwrap();
        let ids: Vec<_> = functions.iter().map(|f| f.logical_id.as_str()).collect();
        assert_eq!(ids, ["Echo", "Legacy", "OrderProcessor"]);
        assert_eq!(skipped, ["Child: nested stacks aren't supported"]);
    }

    #[test]
    fn reads_properties_with_globals_as_fallback() {
        let (functions, _) = parse(TEMPLATE, false).unwrap();
        let orders = by_id(&functions, "OrderProcessor");
        assert_eq!(orders.runtime.as_deref(), Some("dotnet8"));
        assert_eq!(orders.handler.as_deref(), Some("OrderLambda::OrderLambda.Function::FunctionHandler"));
        assert_eq!(orders.code_uri.as_deref(), Some("./src/OrderLambda"));
        assert_eq!(orders.metadata.get("BuildMethod").map(String::as_str), Some("dotnet8"));
        assert_eq!(by_id(&functions, "Echo").runtime.as_deref(), Some("python3.12"));
        // Globals don't apply to AWS::Lambda::Function.
        assert_eq!(by_id(&functions, "Legacy").runtime, None);
    }

    #[test]
    fn intrinsic_names_are_computed_not_evaluated() {
        let (functions, _) = parse(TEMPLATE, false).unwrap();
        assert_eq!(by_id(&functions, "OrderProcessor").function_name, ConfiguredName::Computed);
        assert_eq!(by_id(&functions, "Echo").function_name, ConfiguredName::Literal("kui-echo".into()));
        assert_eq!(by_id(&functions, "Legacy").function_name, ConfiguredName::NotSet);
    }

    #[test]
    fn lists_kafka_event_topics() {
        let (functions, _) = parse(TEMPLATE, false).unwrap();
        assert_eq!(by_id(&functions, "OrderProcessor").kafka_topics, ["demo.orders"]);
        assert!(by_id(&functions, "Echo").kafka_topics.is_empty());
    }

    #[test]
    fn reads_json_templates() {
        let json = r#"{"Resources":{"Fn":{"Type":"AWS::Serverless::Function","Properties":{"Runtime":"nodejs20.x","FunctionName":{"Fn::Sub":"x"}}}}}"#;
        let (functions, _) = parse(json, true).unwrap();
        assert_eq!(functions[0].runtime.as_deref(), Some("nodejs20.x"));
        assert_eq!(functions[0].function_name, ConfiguredName::Computed);
    }

    #[test]
    fn anchors_and_aliases_resolve() {
        let yaml = "Base: &base\n  Runtime: java21\nResources:\n  Fn:\n    Type: AWS::Serverless::Function\n    Properties: *base\n";
        let (functions, _) = parse(yaml, false).unwrap();
        assert_eq!(functions[0].runtime.as_deref(), Some("java21"));
    }
}

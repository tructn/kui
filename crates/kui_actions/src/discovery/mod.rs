//! Finds the Lambda functions in an AWS SAM project by reading its template.
//! The template is the only source of truth; handler code is never read.

use std::fs;
use std::io::Read;
use std::path::Path;

mod template;
mod yaml;

use crate::model::{DiscoveredFunction, Discovery};
use crate::{Error, Result};

/// Checked in order. `sam build` output comes first because it is what
/// `sam local start-lambda` serves once it exists.
const TEMPLATES: [&str; 4] = [".aws-sam/build/template.yaml", "template.yaml", "template.yml", "template.json"];
const MAX_TEMPLATE_BYTES: u64 = 1024 * 1024;

pub fn discover(project_dir: &Path) -> Result<Discovery> {
    let Some(template) = TEMPLATES.iter().find(|t| project_dir.join(t).is_file()) else {
        return Err(Error::msg(
            "No SAM template here. Choose the folder with template.yaml, or type the function name instead.",
        ));
    };
    let text = read_capped(&project_dir.join(template))?;
    let (functions, skipped) =
        parse(&text, template.ends_with(".json")).map_err(|e| Error::msg(format!("{template}: {e}")))?;
    Ok(Discovery {
        project_dir: project_dir.display().to_string(),
        template: (*template).to_string(),
        functions,
        skipped,
    })
}

fn read_capped(path: &Path) -> Result<String> {
    let mut text = String::new();
    fs::File::open(path)?.take(MAX_TEMPLATE_BYTES + 1).read_to_string(&mut text)?;
    if text.len() as u64 > MAX_TEMPLATE_BYTES {
        return Err(Error::msg("The SAM template is over 1 MiB, which is too big to be a template"));
    }
    Ok(text)
}

type Parsed = (Vec<DiscoveredFunction>, Vec<String>);

pub fn parse(text: &str, json: bool) -> std::result::Result<Parsed, String> {
    let template = if json {
        serde_json::from_str(text).map_err(|e| format!("not valid JSON (line {})", e.line()))?
    } else {
        yaml::to_json(text)?
    };
    template::functions(&template)
}

#[cfg(test)]
pub(crate) mod fixtures {
    use crate::model::DiscoveredFunction;

    pub const TEMPLATE: &str = r#"
AWSTemplateFormatVersion: '2010-09-09'
Transform: AWS::Serverless-2016-10-31
Globals:
  Function:
    Runtime: dotnet8
    Timeout: 30
Resources:
  OrderProcessor:
    Type: AWS::Serverless::Function
    Properties:
      FunctionName: !Sub "${AWS::StackName}-orders"
      Handler: OrderLambda::OrderLambda.Function::FunctionHandler
      CodeUri: ./src/OrderLambda
      Role: !GetAtt OrderRole.Arn
      Events:
        Orders:
          Type: MSK
          Properties:
            Stream: !Ref ClusterArn
            Topics:
              - demo.orders
    Metadata:
      BuildMethod: dotnet8
  Echo:
    Type: AWS::Serverless::Function
    Properties:
      FunctionName: kui-echo
      Runtime: python3.12
      Handler: app.handler
  Legacy:
    Type: AWS::Lambda::Function
    Properties:
      Handler: index.handler
  Child:
    Type: AWS::Serverless::Application
  OrderRole:
    Type: AWS::IAM::Role
"#;

    pub fn by_id<'a>(functions: &'a [DiscoveredFunction], id: &str) -> &'a DiscoveredFunction {
        functions.iter().find(|f| f.logical_id == id).unwrap()
    }
}

#[cfg(test)]
mod tests {
    use super::fixtures::{TEMPLATE, by_id};
    use super::*;

    #[test]
    fn reports_where_a_template_is_broken() {
        let error = parse("Resources:\n  Fn: [unclosed\n", false).unwrap_err();
        assert!(error.starts_with("not valid YAML"), "{error}");
        assert!(error.contains("line"), "{error}");
        assert_eq!(parse("Other: 1", false).unwrap_err(), "it has no Resources section");
        assert!(parse("{", true).unwrap_err().starts_with("not valid JSON"));
    }

    #[test]
    fn discovers_the_example_project() {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../examples/order-lambda");
        let found = discover(&dir).unwrap();
        let ids: Vec<_> = found.functions.iter().map(|f| f.logical_id.as_str()).collect();
        assert_eq!(ids, ["OrderProcessor", "RawOrderProcessor"]);
        let orders = by_id(&found.functions, "OrderProcessor");
        assert_eq!(orders.runtime.as_deref(), Some("dotnet8"));
        assert_eq!(orders.code_uri.as_deref(), Some("./src/OrderLambda"));
        assert_eq!(orders.kafka_topics, ["demo.orders"]);
    }

    #[test]
    fn discover_prefers_the_built_template_and_caps_size() {
        let dir = std::env::temp_dir().join(format!("kui-discovery-{}", std::process::id()));
        fs::create_dir_all(dir.join(".aws-sam/build")).unwrap();
        fs::write(dir.join("template.yaml"), "Resources: {}").unwrap();
        fs::write(dir.join(".aws-sam/build/template.yaml"), TEMPLATE).unwrap();
        let found = discover(&dir).unwrap();
        assert_eq!(found.template, ".aws-sam/build/template.yaml");
        assert_eq!(found.functions.len(), 3);

        fs::write(dir.join(".aws-sam/build/template.yaml"), "#".repeat(MAX_TEMPLATE_BYTES as usize + 1)).unwrap();
        assert!(discover(&dir).is_err());
        fs::remove_dir_all(&dir).unwrap();
        assert!(discover(&dir).is_err());
    }
}

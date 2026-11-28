//! The file teammates pass around to share Action setups. It leaves out what
//! only makes sense on one machine, the Action's id and the cluster it was
//! saved under, so an import lands on whichever cluster the user is viewing.

use std::io::Read;
use std::path::Path;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::model::{Action, Executor, Source};
use crate::{Error, Result};

const FORMAT: &str = "kui.actions";
const VERSION: u32 = 1;
/// Far more than any real set of Actions; picking a log or a dump by mistake
/// must not read it all into memory.
pub const MAX_FILE_BYTES: u64 = 1024 * 1024;
pub const MAX_ACTIONS: usize = 200;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SharedAction {
    pub name: String,
    pub source: Source,
    pub executor: Executor,
}

impl SharedAction {
    pub fn into_action(self, cluster_id: &str) -> Action {
        Action {
            id: String::new(),
            name: self.name,
            cluster_id: cluster_id.to_string(),
            source: self.source,
            executor: self.executor,
        }
    }
}

impl From<&Action> for SharedAction {
    fn from(action: &Action) -> Self {
        Self { name: action.name.clone(), source: action.source.clone(), executor: action.executor.clone() }
    }
}

#[derive(Serialize)]
struct Bundle<'a> {
    format: &'a str,
    version: u32,
    actions: Vec<SharedAction>,
}

pub fn export(actions: &[Action]) -> Result<String> {
    let bundle = Bundle { format: FORMAT, version: VERSION, actions: actions.iter().map(SharedAction::from).collect() };
    serde_json::to_string_pretty(&bundle).map_err(|_| Error::msg("Couldn't write the actions file"))
}

/// Accepts an exported file, a bare list of Actions (such as KUI's own
/// `actions.json`) or a single Action written by hand.
pub fn parse(json: &str) -> Result<Vec<SharedAction>> {
    let value: Value = serde_json::from_str(json)
        .map_err(|e| Error::msg(format!("That file isn't valid JSON (line {}, column {})", e.line(), e.column())))?;
    let items = match value {
        Value::Object(mut bundle) if bundle.contains_key("actions") => {
            check_header(&bundle)?;
            match bundle.remove("actions") {
                Some(Value::Array(items)) => items,
                _ => return Err(Error::msg("The file's \"actions\" must be a list")),
            }
        }
        Value::Array(items) => items,
        single @ Value::Object(_) => vec![single],
        _ => return Err(Error::msg("That file doesn't hold KUI actions")),
    };
    if items.is_empty() {
        return Err(Error::msg("That file has no actions"));
    }
    if items.len() > MAX_ACTIONS {
        return Err(Error::msg(format!("A file can hold at most {MAX_ACTIONS} actions")));
    }
    items
        .into_iter()
        .enumerate()
        .map(|(i, item)| {
            serde_json::from_value(item)
                .map_err(|e| Error::msg(format!("Action {} in the file {}", i + 1, describe(&e))))
        })
        .collect()
}

fn check_header(bundle: &serde_json::Map<String, Value>) -> Result<()> {
    if bundle.get("format").and_then(Value::as_str).is_some_and(|f| f != FORMAT) {
        return Err(Error::msg("That file doesn't hold KUI actions"));
    }
    if bundle.get("version").and_then(Value::as_u64).is_some_and(|v| v > u64::from(VERSION)) {
        return Err(Error::msg("That file comes from a newer KUI. Update KUI to import it"));
    }
    Ok(())
}

/// serde quotes the offending value in most of its messages; only the
/// missing-field one is safe to show as it is, since it names just the field.
fn describe(e: &serde_json::Error) -> String {
    let message = e.to_string();
    match message.strip_prefix("missing field ") {
        Some(field) => format!("is missing {}", field.split(" at line").next().unwrap_or(field)),
        None => "has a value KUI doesn't understand (check runtime, startFrom and the numbers)".into(),
    }
}

/// Reads at most `MAX_FILE_BYTES`, so a huge file is refused without being loaded.
pub fn read_file(path: &Path) -> Result<String> {
    let file = std::fs::File::open(path)?;
    let mut json = String::new();
    file.take(MAX_FILE_BYTES + 1).read_to_string(&mut json).map_err(|_| Error::msg("That file isn't a text file"))?;
    if json.len() as u64 > MAX_FILE_BYTES {
        return Err(Error::msg("That file is too large to be an actions file"));
    }
    Ok(json)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{LambdaRuntime, LambdaTarget, StartFrom};

    fn saved() -> Action {
        Action {
            id: "abc".into(),
            name: "Orders".into(),
            cluster_id: "local".into(),
            source: Source {
                topic: "demo.orders".into(),
                group_id: "kui-action-orders".into(),
                start_from: StartFrom::Earliest,
            },
            executor: Executor::LocalLambda(LambdaTarget {
                runtime: LambdaRuntime::TestTool,
                endpoint: "http://localhost:5050".into(),
                function_name: "OrderProcessor".into(),
                timeout_secs: 600,
                concurrency: 1,
            }),
        }
    }

    #[test]
    fn exports_without_local_ids_and_reads_its_own_output() {
        let json = export(&[saved()]).unwrap();
        assert!(!json.contains("abc") && !json.contains("clusterId"));
        let imported = parse(&json).unwrap();
        assert_eq!(imported, vec![SharedAction::from(&saved())]);
        let action = imported[0].clone().into_action("team-dev");
        assert_eq!((action.id.as_str(), action.cluster_id.as_str()), ("", "team-dev"));
    }

    #[test]
    fn accepts_a_saved_actions_list_and_a_single_action() {
        let list = serde_json::to_string(&vec![saved()]).unwrap();
        assert_eq!(parse(&list).unwrap().len(), 1);
        let single = serde_json::to_string(&SharedAction::from(&saved())).unwrap();
        assert_eq!(parse(&single).unwrap()[0].name, "Orders");
    }

    #[test]
    fn refuses_files_that_are_not_actions() {
        for bad in ["not json", "42", "[]", r#"{"actions":{}}"#, r#"{"format":"other","actions":[]}"#] {
            assert!(parse(bad).is_err(), "{bad}");
        }
        let newer = r#"{"format":"kui.actions","version":99,"actions":[]}"#;
        assert!(parse(newer).unwrap_err().to_string().contains("newer KUI"));
    }

    #[test]
    fn names_the_missing_field_but_never_quotes_values() {
        let executor = r#""executor":{"kind":"localLambda","endpoint":"http://h","functionName":"F","timeoutSecs":1,"concurrency":1}"#;
        let missing = format!(r#"[{{"name":"A",{executor}}}]"#);
        assert_eq!(parse(&missing).unwrap_err().to_string(), "Action 1 in the file is missing `source`");
        let wrong =
            format!(r#"{{"name":"A","source":{{"topic":"t","groupId":"g","startFrom":"hunter2"}},{executor}}}"#);
        let wrong = wrong.as_str();
        let message = parse(wrong).unwrap_err().to_string();
        assert!(message.starts_with("Action 1 in the file has a value"));
        assert!(!message.contains("hunter2"), "the error message quotes a value from the file");
    }

    #[test]
    fn caps_the_number_of_actions() {
        let many = serde_json::to_string(&vec![SharedAction::from(&saved()); MAX_ACTIONS + 1]).unwrap();
        assert!(parse(&many).is_err());
    }

    #[test]
    fn refuses_files_over_the_size_limit() {
        let path = std::env::temp_dir().join(format!("kui-share-{}.json", std::process::id()));
        std::fs::write(&path, vec![b' '; MAX_FILE_BYTES as usize + 1]).unwrap();
        assert!(read_file(&path).is_err());
        std::fs::remove_file(&path).unwrap();
    }
}

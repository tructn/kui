use std::path::PathBuf;

use kui_actions::model::Action;
use kui_actions::share::SharedAction;
use kui_actions::validate;

use crate::error::{Error, Result};
use crate::json_file;

/// Saved Actions in `actions.json`. They hold no secrets: the cluster is
/// referenced by id and its credentials stay with the cluster store.
pub struct ActionStore {
    path: PathBuf,
    actions: Vec<Action>,
}

impl ActionStore {
    pub fn load(path: PathBuf) -> Result<Self> {
        Ok(Self { actions: json_file::load(&path)?, path })
    }

    pub fn list(&self, cluster_id: &str) -> Vec<Action> {
        self.actions.iter().filter(|a| a.cluster_id == cluster_id).cloned().collect()
    }

    pub fn get(&self, id: &str) -> Result<Action> {
        self.actions.iter().find(|a| a.id == id).cloned().ok_or_else(|| Error::msg("That action no longer exists"))
    }

    /// Adds a new Action (empty id) or replaces the saved one.
    pub fn save(&mut self, action: Action) -> Result<Action> {
        let mut action = checked(action)?;
        if action.id.is_empty() {
            action.id = uuid::Uuid::new_v4().to_string();
            self.actions.push(action.clone());
        } else {
            let saved = self.actions.iter_mut().find(|a| a.id == action.id);
            *saved.ok_or_else(|| Error::msg("That action no longer exists"))? = action.clone();
        }
        self.persist()?;
        Ok(action)
    }

    /// Adds shared Actions to `cluster_id` as new ones. All or nothing: one
    /// invalid Action adds none, so a retry after fixing the file can't duplicate the rest.
    pub fn import(&mut self, cluster_id: &str, shared: Vec<SharedAction>) -> Result<Vec<Action>> {
        let imported = shared
            .into_iter()
            .enumerate()
            .map(|(i, s)| {
                let mut action =
                    checked(s.into_action(cluster_id)).map_err(|e| Error::msg(format!("Action {}: {e}", i + 1)))?;
                action.id = uuid::Uuid::new_v4().to_string();
                Ok(action)
            })
            .collect::<Result<Vec<_>>>()?;
        self.actions.extend(imported.iter().cloned());
        if let Err(e) = self.persist() {
            self.actions.truncate(self.actions.len() - imported.len());
            return Err(e);
        }
        Ok(imported)
    }

    pub fn delete(&mut self, id: &str) -> Result<()> {
        self.actions.retain(|a| a.id != id);
        self.persist()
    }

    fn persist(&self) -> Result<()> {
        json_file::save(&self.path, &self.actions)
    }
}

fn checked(mut action: Action) -> Result<Action> {
    validate::action(&action)?;
    action.name = action.name.trim().to_string();
    action.source.group_id = action.source.group_id.trim().to_string();
    Ok(action)
}

#[cfg(test)]
mod tests {
    use kui_actions::model::{Executor, LambdaRuntime, LambdaTarget, Source, StartFrom};

    use super::*;

    fn draft() -> Action {
        Action {
            id: String::new(),
            name: " Orders ".into(),
            cluster_id: "local".into(),
            source: Source {
                topic: "demo.orders".into(),
                group_id: "kui-action-orders ".into(),
                start_from: StartFrom::Latest,
            },
            executor: Executor::LocalLambda(LambdaTarget {
                runtime: LambdaRuntime::Sam,
                endpoint: "http://127.0.0.1:3001".into(),
                function_name: "OrderProcessor".into(),
                timeout_secs: 30,
                concurrency: 1,
            }),
        }
    }

    fn temp_path() -> PathBuf {
        std::env::temp_dir().join(format!("kui-actions-{}.json", uuid::Uuid::new_v4()))
    }

    #[test]
    fn saves_new_actions_and_reloads_them() {
        let path = temp_path();
        let mut store = ActionStore::load(path.clone()).unwrap();
        let saved = store.save(draft()).unwrap();
        assert!(!saved.id.is_empty());
        assert_eq!(saved.name, "Orders");
        assert_eq!(saved.source.group_id, "kui-action-orders");

        let reloaded = ActionStore::load(path.clone()).unwrap();
        assert_eq!(reloaded.list("local"), vec![saved.clone()]);
        assert!(reloaded.list("other").is_empty());
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn updates_in_place_and_deletes() {
        let path = temp_path();
        let mut store = ActionStore::load(path.clone()).unwrap();
        let mut saved = store.save(draft()).unwrap();
        saved.name = "Renamed".into();
        store.save(saved.clone()).unwrap();
        assert_eq!(store.list("local").len(), 1);
        assert_eq!(store.get(&saved.id).unwrap().name, "Renamed");

        store.delete(&saved.id).unwrap();
        assert!(store.get(&saved.id).is_err());
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn refuses_invalid_or_unknown_actions() {
        let path = temp_path();
        let mut store = ActionStore::load(path.clone()).unwrap();
        let mut invalid = draft();
        invalid.source.topic.clear();
        assert!(store.save(invalid).is_err());
        let mut unknown = draft();
        unknown.id = "missing".into();
        assert!(store.save(unknown).is_err());
        assert!(!path.exists());
    }

    #[test]
    fn imports_shared_actions_as_new_ones_on_the_current_cluster() {
        let path = temp_path();
        let mut store = ActionStore::load(path.clone()).unwrap();
        let original = store.save(draft()).unwrap();
        let shared = vec![SharedAction::from(&Action { cluster_id: "elsewhere".into(), ..draft() })];

        let imported = store.import("team", shared).unwrap();
        assert_eq!(imported.len(), 1);
        assert_ne!(imported[0].id, original.id);
        assert_eq!((imported[0].cluster_id.as_str(), imported[0].name.as_str()), ("team", "Orders"));
        assert_eq!(ActionStore::load(path.clone()).unwrap().list("team"), imported);
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn one_invalid_shared_action_imports_none() {
        let path = temp_path();
        let mut store = ActionStore::load(path.clone()).unwrap();
        let mut invalid = draft();
        invalid.source.topic.clear();
        let shared = vec![SharedAction::from(&draft()), SharedAction::from(&invalid)];

        let error = store.import("team", shared).unwrap_err().to_string();
        assert!(error.starts_with("Action 2:"), "{error}");
        assert!(store.list("team").is_empty());
        assert!(!path.exists());
    }
}

use std::path::PathBuf;

use kui_actions::model::Action;
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
    pub fn save(&mut self, mut action: Action) -> Result<Action> {
        validate::action(&action)?;
        action.name = action.name.trim().to_string();
        action.source.group_id = action.source.group_id.trim().to_string();
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

    pub fn delete(&mut self, id: &str) -> Result<()> {
        self.actions.retain(|a| a.id != id);
        self.persist()
    }

    fn persist(&self) -> Result<()> {
        json_file::save(&self.path, &self.actions)
    }
}

#[cfg(test)]
mod tests {
    use kui_actions::model::{Executor, LambdaRuntime, LambdaTarget, PayloadFormat, Source, StartFrom};

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
                project_dir: None,
                payload: PayloadFormat::Msk,
                timeout_secs: 30,
                concurrency: 1,
                debug: false,
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
}

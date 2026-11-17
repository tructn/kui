use std::collections::HashSet;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use super::model::{Action, Automation};
use super::validate;
use crate::error::{Error, Result};
use crate::json_file;
use crate::secret_store::SecretStore;

/// Automations persisted in `automations.json` in the app config directory. A webhook's URL
/// and header values are credentials, so they live in the OS keychain instead (see `Secrets`).
///
/// Like cluster passwords, they stay in the file (readable by the owner only) when there is
/// no keychain to use, so the automation keeps working.
pub struct AutomationStore {
    path: PathBuf,
    /// Held in memory with their secrets filled in.
    items: Vec<Automation>,
    keychain: Box<dyn SecretStore>,
    /// Ids whose secrets are in the keychain, so the file holds none of them.
    in_keychain: HashSet<String>,
}

/// The parts of an automation that are credentials, kept as one keychain item.
#[derive(Default, Serialize, Deserialize)]
struct Secrets {
    url: String,
    header_values: Vec<String>,
}

fn keychain_id(id: &str) -> String {
    format!("automation:{id}")
}

impl Secrets {
    /// Moves the secrets out of `automation`, leaving those fields empty.
    fn take(automation: &mut Automation) -> Self {
        match &mut automation.action {
            Action::Webhook(w) => Secrets {
                url: std::mem::take(&mut w.url),
                header_values: w.headers.iter_mut().map(|h| std::mem::take(&mut h.value)).collect(),
            },
        }
    }

    fn restore(self, automation: &mut Automation) {
        match &mut automation.action {
            Action::Webhook(w) => {
                w.url = self.url;
                for (header, value) in w.headers.iter_mut().zip(self.header_values) {
                    header.value = value;
                }
            }
        }
    }

    fn is_empty(&self) -> bool {
        self.url.is_empty() && self.header_values.iter().all(String::is_empty)
    }

    fn save(&self, keychain: &dyn SecretStore, id: &str) -> Result<()> {
        keychain.set(&keychain_id(id), &serde_json::to_string(self)?)
    }

    fn load(keychain: &dyn SecretStore, id: &str) -> Result<Self> {
        match keychain.get(&keychain_id(id))? {
            Some(json) => serde_json::from_str(&json)
                .map_err(|_| Error::msg("The keychain item for this automation is unreadable.")),
            None => Ok(Self::default()),
        }
    }
}

impl AutomationStore {
    pub fn load(path: PathBuf, keychain: Box<dyn SecretStore>) -> Result<Self> {
        let items: Vec<Automation> = json_file::load(&path)?;
        let mut store = Self { path, items, keychain, in_keychain: HashSet::new() };

        let mut migrated = false;
        for automation in &mut store.items {
            let in_file = Secrets::take(&mut automation.clone());
            if in_file.is_empty() {
                // A locked or missing keychain leaves the webhook without a URL; the
                // automation then reports an invalid URL when it runs.
                match Secrets::load(&*store.keychain, &automation.id) {
                    Ok(secrets) if !secrets.is_empty() => {
                        secrets.restore(automation);
                        store.in_keychain.insert(automation.id.clone());
                    }
                    _ => {}
                }
            } else if in_file.save(&*store.keychain, &automation.id).is_ok() {
                // Saved while there was no keychain: move them over now.
                store.in_keychain.insert(automation.id.clone());
                migrated = true;
            }
        }
        if migrated {
            store.persist()?;
        }
        Ok(store)
    }

    pub fn list(&self) -> Vec<Automation> {
        self.items.clone()
    }

    #[cfg(test)]
    pub fn get(&self, id: &str) -> Result<Automation> {
        self.items.iter().find(|a| a.id == id).cloned().ok_or_else(|| Error::msg("Unknown automation."))
    }

    /// Inserts a new automation (assigning an id) or replaces an existing one. An id from the
    /// caller must name an automation that exists: ids are only ever issued here, and double as
    /// the keychain item name.
    pub fn save(&mut self, mut automation: Automation) -> Result<Automation> {
        validate::automation(&automation)?;
        if automation.id.is_empty() {
            automation.id = uuid::Uuid::new_v4().to_string();
        } else if !self.items.iter().any(|a| a.id == automation.id) {
            return Err(Error::msg("Unknown automation."));
        }
        let mut stripped = automation.clone();
        if Secrets::take(&mut stripped).save(&*self.keychain, &automation.id).is_ok() {
            self.in_keychain.insert(automation.id.clone());
        } else {
            self.in_keychain.remove(&automation.id);
        }
        match self.items.iter_mut().find(|a| a.id == automation.id) {
            Some(existing) => *existing = automation.clone(),
            None => self.items.push(automation.clone()),
        }
        self.persist()?;
        Ok(automation)
    }

    pub fn set_enabled(&mut self, id: &str, enabled: bool) -> Result<Automation> {
        let automation = self.items.iter_mut().find(|a| a.id == id).ok_or_else(|| Error::msg("Unknown automation."))?;
        automation.enabled = enabled;
        let updated = automation.clone();
        self.persist()?;
        Ok(updated)
    }

    pub fn delete(&mut self, id: &str) -> Result<()> {
        self.items.retain(|a| a.id != id);
        self.in_keychain.remove(id);
        // Best effort: a missing keychain has nothing to clean up.
        let _ = self.keychain.delete(&keychain_id(id));
        self.persist()
    }

    fn persist(&self) -> Result<()> {
        let on_disk: Vec<Automation> = self
            .items
            .iter()
            .map(|a| {
                let mut a = a.clone();
                if self.in_keychain.contains(&a.id) {
                    Secrets::take(&mut a);
                }
                a
            })
            .collect();
        json_file::save(&self.path, &on_disk)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::features::automations::model::{Body, HttpMethod, Webhook, WebhookHeader};
    use crate::features::clusters::secrets::testing::{MemoryKeychain, NoKeychain};

    const URL: &str = "https://hooks.example.com/T000/SECRET-URL";
    const TOKEN: &str = "Bearer SECRET-TOKEN";

    fn automation() -> Automation {
        Automation {
            id: String::new(),
            name: "Alert".into(),
            enabled: true,
            cluster_id: "c".into(),
            topic: "orders".into(),
            query: None,
            max_per_minute: 60,
            action: Action::Webhook(Webhook {
                url: URL.into(),
                method: HttpMethod::Post,
                headers: vec![WebhookHeader { name: "Authorization".into(), value: TOKEN.into() }],
                body: Body::Envelope,
            }),
        }
    }

    fn temp_path() -> PathBuf {
        std::env::temp_dir().join(format!("kui-automations-{}", uuid::Uuid::new_v4())).join("automations.json")
    }

    fn webhook(a: &Automation) -> &Webhook {
        let Action::Webhook(w) = &a.action;
        w
    }

    #[test]
    fn secrets_go_to_the_keychain_and_come_back_on_load() {
        let (path, keychain) = (temp_path(), MemoryKeychain::default());
        let mut store = AutomationStore::load(path.clone(), Box::new(keychain.clone())).unwrap();
        let saved = store.save(automation()).unwrap();

        let file = std::fs::read_to_string(&path).unwrap();
        assert!(!file.contains("SECRET"), "automations.json holds a credential");
        assert!(file.contains("Authorization"));

        let reloaded = AutomationStore::load(path.clone(), Box::new(keychain)).unwrap();
        let loaded = reloaded.get(&saved.id).unwrap();
        assert_eq!(webhook(&loaded).url, URL);
        assert_eq!(webhook(&loaded).headers[0].value, TOKEN);
        std::fs::remove_dir_all(path.parent().unwrap()).ok();
    }

    #[test]
    fn without_a_keychain_secrets_stay_in_the_file_so_the_automation_still_works() {
        let path = temp_path();
        let mut store = AutomationStore::load(path.clone(), Box::new(NoKeychain)).unwrap();
        let saved = store.save(automation()).unwrap();

        let reloaded = AutomationStore::load(path.clone(), Box::new(NoKeychain)).unwrap();
        assert_eq!(webhook(&reloaded.get(&saved.id).unwrap()).url, URL);
        std::fs::remove_dir_all(path.parent().unwrap()).ok();
    }

    #[test]
    fn a_file_with_inline_secrets_moves_them_to_the_keychain_on_load() {
        let (path, keychain) = (temp_path(), MemoryKeychain::default());
        let mut store = AutomationStore::load(path.clone(), Box::new(NoKeychain)).unwrap();
        let saved = store.save(automation()).unwrap();

        AutomationStore::load(path.clone(), Box::new(keychain.clone())).unwrap();
        assert!(!std::fs::read_to_string(&path).unwrap().contains("SECRET"));
        assert!(keychain.0.lock().unwrap().contains_key(&keychain_id(&saved.id)));
        std::fs::remove_dir_all(path.parent().unwrap()).ok();
    }

    #[test]
    fn only_ids_the_store_issued_can_be_saved_and_deleting_clears_the_keychain() {
        let (path, keychain) = (temp_path(), MemoryKeychain::default());
        let mut store = AutomationStore::load(path.clone(), Box::new(keychain.clone())).unwrap();
        let mut forged = automation();
        forged.id = "../../etc".into();
        assert!(store.save(forged).is_err());

        let saved = store.save(automation()).unwrap();
        store.delete(&saved.id).unwrap();
        assert!(store.list().is_empty());
        assert!(keychain.0.lock().unwrap().is_empty());
        std::fs::remove_dir_all(path.parent().unwrap()).ok();
    }

    #[test]
    fn an_invalid_automation_is_never_stored() {
        let path = temp_path();
        let mut store = AutomationStore::load(path.clone(), Box::new(MemoryKeychain::default())).unwrap();
        let mut bad = automation();
        bad.topic = String::new();
        assert!(store.save(bad).is_err());
        assert!(store.list().is_empty());
    }
}

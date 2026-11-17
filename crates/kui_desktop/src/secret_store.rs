//! Where secrets that must not sit in a JSON file are kept.

use crate::error::{Error, Result};

/// Holds one secret blob per cluster id.
pub trait SecretStore: Send + Sync {
    fn get(&self, id: &str) -> Result<Option<String>>;
    fn set(&self, id: &str, value: &str) -> Result<()>;
    fn delete(&self, id: &str) -> Result<()>;
}

/// The OS credential store: macOS Keychain, Windows Credential Manager, or
/// the Secret Service (GNOME Keyring, KWallet) on Linux.
pub struct Keychain;

const SERVICE: &str = "io.github.tructn.kui";

fn entry(id: &str) -> Result<keyring::Entry> {
    keyring::Entry::new(SERVICE, id).map_err(keychain_error)
}

fn keychain_error(e: keyring::Error) -> Error {
    Error::msg(format!("Could not use the system keychain: {e}"))
}

impl SecretStore for Keychain {
    fn get(&self, id: &str) -> Result<Option<String>> {
        match entry(id)?.get_password() {
            Ok(v) => Ok(Some(v)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(keychain_error(e)),
        }
    }

    fn set(&self, id: &str, value: &str) -> Result<()> {
        entry(id)?.set_password(value).map_err(keychain_error)
    }

    fn delete(&self, id: &str) -> Result<()> {
        match entry(id)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(keychain_error(e)),
        }
    }
}

//! Small helpers for the JSON files KUI keeps in the app config directory.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde::de::DeserializeOwned;

use crate::error::Result;

/// Reads `path`, falling back to `T::default()` when it doesn't exist yet.
///
/// A file that can't be parsed (e.g. edited by hand) is moved aside to
/// `<name>.corrupt` instead of failing, so a bad file never stops the app from
/// starting.
pub fn load<T: DeserializeOwned + Default>(path: &Path) -> Result<T> {
    let json = match fs::read_to_string(path) {
        Ok(json) => json,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(T::default()),
        Err(e) => return Err(e.into()),
    };
    match serde_json::from_str(&json) {
        Ok(value) => Ok(value),
        Err(e) => {
            let backup = sibling(path, "corrupt");
            eprintln!("kui: could not parse {}: {e}; moved it to {}", path.display(), backup.display());
            fs::rename(path, backup)?;
            Ok(T::default())
        }
    }
}

/// Writes `value` to `path` atomically: write a temp file next to it, then
/// rename over the original. Quitting or crashing mid-write leaves either the
/// old file or the new one, never a half-written one.
pub fn save<T: Serialize + ?Sized>(path: &Path, value: &T) -> Result<()> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let tmp = sibling(path, "tmp");
    write_private(&tmp, serde_json::to_string_pretty(value)?.as_bytes())?;
    fs::rename(&tmp, path)?;
    Ok(())
}

/// These files hold cluster passwords, so only the owner may read them (0600
/// on Unix). The mode is set when the file is created, so there is no window
/// in which another user could read it. Windows keeps per-user ACLs on the
/// app config directory instead.
fn write_private(path: &Path, bytes: &[u8]) -> Result<()> {
    use std::io::Write;
    let mut options = fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path)?;
    // A leftover temp file keeps its old mode; tighten it explicitly.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        file.set_permissions(fs::Permissions::from_mode(0o600))?;
    }
    file.write_all(bytes)?;
    file.sync_all()?;
    Ok(())
}

/// `clusters.json` + `tmp` -> `clusters.json.tmp`
fn sibling(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(format!(".{suffix}"));
    path.with_file_name(name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn temp_path() -> PathBuf {
        std::env::temp_dir().join(format!("kui-json-{}", uuid::Uuid::new_v4())).join("data.json")
    }

    #[test]
    fn missing_file_loads_default_and_save_round_trips() {
        let path = temp_path();
        let empty: HashMap<String, i32> = load(&path).unwrap();
        assert!(empty.is_empty());

        save(&path, &HashMap::from([("a".to_string(), 1)])).unwrap();
        let loaded: HashMap<String, i32> = load(&path).unwrap();
        assert_eq!(loaded["a"], 1);
        assert!(!sibling(&path, "tmp").exists());
        fs::remove_dir_all(path.parent().unwrap()).ok();
    }

    #[cfg(unix)]
    #[test]
    fn saved_files_are_readable_by_the_owner_only() {
        use std::os::unix::fs::PermissionsExt;
        let path = temp_path();
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        // An existing world-readable file (written by an older version) gets tightened.
        fs::write(&path, "{}").unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();

        save(&path, &HashMap::from([("password".to_string(), "secret".to_string())])).unwrap();
        let mode = fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600, "mode {mode:o}");
        fs::remove_dir_all(path.parent().unwrap()).ok();
    }

    #[test]
    fn corrupt_file_is_moved_aside() {
        let path = temp_path();
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, "{ not json").unwrap();

        let loaded: Vec<String> = load(&path).unwrap();
        assert!(loaded.is_empty());
        assert!(sibling(&path, "corrupt").exists());
        fs::remove_dir_all(path.parent().unwrap()).ok();
    }
}

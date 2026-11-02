//! In-app updates from the project's GitHub releases.
//!
//! Every release carries a `latest.json` manifest (written by the release
//! workflow) pointing at that release's signed installers. Tauri's updater
//! takes one manifest URL, and GitHub's `releases/latest` alias only ever
//! means the newest stable release, so the channel is picked here instead:
//! the newest release that has a manifest, release candidates included only
//! when the user opted in. The updater then checks that manifest, offers it
//! only if it is newer than the running version, and verifies the download's
//! signature against the public key in `tauri.conf.json`.
//!
//! Switching release candidates off never downgrades: SemVer orders
//! 0.3.0-rc.1 before 0.3.0, so the user simply moves on with the next stable.

use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tauri::{AppHandle, State};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::error::{Error, Result};

const RELEASES_URL: &str = "https://api.github.com/repos/tructn/kui/releases?per_page=30";
const MANIFEST: &str = "latest.json";
const TIMEOUT: Duration = Duration::from_secs(20);

/// The update found by the last check, kept for `install_update`.
#[derive(Default)]
pub struct PendingUpdate(Mutex<Option<Update>>);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AvailableUpdate {
    pub version: String,
    pub current_version: String,
    /// Release notes (Markdown), from the release's CHANGELOG section.
    pub notes: Option<String>,
    pub prerelease: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "event")]
pub enum DownloadEvent {
    Progress {
        downloaded: u64,
        total: Option<u64>,
    },
    /// Downloaded and verified; installing. On Windows the app exits here.
    Installing,
}

/// The subset of GitHub's release JSON used to pick a release.
#[derive(Debug, Deserialize)]
struct Release {
    tag_name: String,
    draft: bool,
    prerelease: bool,
    assets: Vec<Asset>,
}

#[derive(Debug, Deserialize)]
struct Asset {
    name: String,
}

/// Looks for a newer version. `None` when the app is up to date.
#[tauri::command]
pub async fn check_for_update(
    app: AppHandle,
    pending: State<'_, PendingUpdate>,
    include_prereleases: bool,
) -> Result<Option<AvailableUpdate>> {
    let releases = fetch_releases().await?;
    let Some(release) = newest(&releases, include_prereleases) else {
        return Ok(None);
    };
    let manifest = format!("https://github.com/tructn/kui/releases/download/{}/{MANIFEST}", release.tag_name);
    let manifest = manifest.parse().map_err(|e| Error::msg(format!("Bad manifest URL {manifest}: {e}")))?;
    let update = app.updater_builder().endpoints(vec![manifest])?.timeout(TIMEOUT).build()?.check().await?;

    let available = update.as_ref().map(|u| AvailableUpdate {
        version: u.version.clone(),
        current_version: u.current_version.clone(),
        notes: u.body.clone(),
        prerelease: release.prerelease,
    });
    *pending.0.lock().unwrap() = update;
    Ok(available)
}

/// Downloads, verifies and installs the update found by the last check, then
/// restarts the app. Only returns on failure.
#[tauri::command]
pub async fn install_update(
    app: AppHandle,
    pending: State<'_, PendingUpdate>,
    on_event: Channel<DownloadEvent>,
) -> Result<()> {
    let update = pending.0.lock().unwrap().take().ok_or_else(|| Error::msg("No update to install; check again"))?;
    let mut downloaded = 0u64;
    update
        .download_and_install(
            |chunk, total| {
                downloaded += chunk as u64;
                let _ = on_event.send(DownloadEvent::Progress { downloaded, total });
            },
            || {
                let _ = on_event.send(DownloadEvent::Installing);
            },
        )
        .await?;
    app.restart()
}

async fn fetch_releases() -> Result<Vec<Release>> {
    // The updater installs the same provider before its own requests; whoever
    // gets there first wins, and either way it's ring.
    let _ = rustls::crypto::ring::default_provider().install_default();
    let client =
        reqwest::Client::builder().user_agent(concat!("KUI/", env!("CARGO_PKG_VERSION"))).timeout(TIMEOUT).build()?;
    let response = client.get(RELEASES_URL).header("Accept", "application/vnd.github+json").send().await?;
    if !response.status().is_success() {
        return Err(Error::msg(format!("GitHub answered {} when listing releases", response.status())));
    }
    Ok(response.json().await?)
}

/// The highest-versioned published release with an update manifest, skipping
/// pre-releases unless asked for. Tags that aren't `v` + SemVer are ignored.
fn newest(releases: &[Release], include_prereleases: bool) -> Option<&Release> {
    releases
        .iter()
        .filter(|r| !r.draft && (include_prereleases || !r.prerelease))
        .filter(|r| r.assets.iter().any(|a| a.name == MANIFEST))
        .filter_map(|r| Some((semver::Version::parse(r.tag_name.strip_prefix('v')?).ok()?, r)))
        .max_by(|(a, _), (b, _)| a.cmp(b))
        .map(|(_, r)| r)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn release(tag: &str, prerelease: bool, has_manifest: bool) -> Release {
        let assets = if has_manifest { vec![Asset { name: MANIFEST.into() }] } else { vec![] };
        Release { tag_name: tag.into(), draft: false, prerelease, assets }
    }

    fn pick(releases: &[Release], include_prereleases: bool) -> Option<&str> {
        newest(releases, include_prereleases).map(|r| r.tag_name.as_str())
    }

    #[test]
    fn stable_channel_skips_release_candidates() {
        let releases = [release("v0.3.0-rc.1", true, true), release("v0.2.0", false, true)];
        assert_eq!(pick(&releases, false), Some("v0.2.0"));
        assert_eq!(pick(&releases, true), Some("v0.3.0-rc.1"));
    }

    #[test]
    fn a_stable_release_beats_its_own_candidates() {
        let releases = [release("v0.3.0-rc.2", true, true), release("v0.3.0", false, true)];
        assert_eq!(pick(&releases, true), Some("v0.3.0"));
    }

    #[test]
    fn picks_by_version_not_by_listing_order() {
        // A patch for an older line published after a newer release.
        let releases = [release("v0.2.1", false, true), release("v0.3.0", false, true)];
        assert_eq!(pick(&releases, false), Some("v0.3.0"));
    }

    #[test]
    fn skips_drafts_odd_tags_and_releases_without_a_manifest() {
        let mut draft = release("v0.9.0", false, true);
        draft.draft = true;
        let releases = [
            draft,
            release("nightly", false, true),
            release("v0.5.0", false, false), // published before in-app updates
            release("v0.4.0", false, true),
        ];
        assert_eq!(pick(&releases, true), Some("v0.4.0"));
        assert_eq!(pick(&[], true), None);
    }
}

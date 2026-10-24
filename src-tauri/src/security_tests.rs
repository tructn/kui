//! Guards for the app's security controls (OWASP Top 10).
//! They fail when a control is weakened, e.g. the CSP loosened, a broad Tauri
//! permission granted, or an HTML-injection sink added to the UI.
//!
//! Behavioural checks live next to the code they test and are referenced here
//! by name, so `cargo test security` runs this file and the rest.

use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;

fn repo() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap().to_path_buf()
}

fn tauri_config() -> Value {
    let text = fs::read_to_string(repo().join("src-tauri/tauri.conf.json")).unwrap();
    serde_json::from_str(&text).unwrap()
}

fn csp(key: &str) -> serde_json::Map<String, Value> {
    tauri_config()["app"]["security"][key]
        .as_object()
        .unwrap_or_else(|| panic!("app.security.{key} must be set (a null CSP allows anything)"))
        .clone()
}

/// Every .ts/.tsx file under `src/`, excluding tests.
fn frontend_sources() -> Vec<(PathBuf, String)> {
    fn walk(dir: &Path, out: &mut Vec<(PathBuf, String)>) {
        for entry in fs::read_dir(dir).unwrap().flatten() {
            let path = entry.path();
            if path.is_dir() {
                walk(&path, out);
            } else if matches!(path.extension().and_then(|e| e.to_str()), Some("ts" | "tsx"))
                && !path.to_string_lossy().contains(".test.")
            {
                out.push((path.clone(), fs::read_to_string(&path).unwrap()));
            }
        }
    }
    let mut out = Vec::new();
    walk(&repo().join("src"), &mut out);
    assert!(out.len() > 20, "found too few sources; wrong directory?");
    out
}

// --- A05 Security misconfiguration / A03 Injection (XSS) ----------------------

#[test]
fn security_csp_is_strict_in_production() {
    let csp = csp("csp");
    let get = |d: &str| csp.get(d).and_then(Value::as_str).unwrap_or_else(|| panic!("CSP lacks {d}"));

    // Scripts only from the app bundle: no inline, no eval, no remote hosts.
    assert_eq!(get("script-src"), "'self'");
    assert_eq!(get("default-src"), "'self'");
    for directive in csp.keys() {
        let value = get(directive);
        assert!(!value.contains("unsafe-eval"), "{directive}: {value}");
        assert!(!value.contains('*'), "{directive} allows any host: {value}");
        assert!(!value.contains("http://") || value == "ipc: http://ipc.localhost", "{directive}: {value}");
    }
    // The webview only talks to Rust over IPC; Kafka/REST traffic goes through Rust.
    assert_eq!(get("connect-src"), "ipc: http://ipc.localhost");
    for (directive, expected) in
        [("object-src", "'none'"), ("base-uri", "'none'"), ("form-action", "'none'"), ("frame-ancestors", "'none'")]
    {
        assert_eq!(get(directive), expected, "{directive}");
    }
}

#[test]
fn security_dev_csp_differs_only_for_hot_reload() {
    let (prod, dev) = (csp("csp"), csp("devCsp"));
    assert_eq!(prod.keys().collect::<Vec<_>>(), dev.keys().collect::<Vec<_>>());
    for (directive, value) in &dev {
        let value = value.as_str().unwrap();
        assert!(!value.contains("unsafe-eval") && !value.contains('*'), "{directive}: {value}");
        let local_only = value.split_whitespace().all(|source| {
            prod[directive].as_str().unwrap().split_whitespace().any(|p| p == source)
                || source == "'unsafe-inline'"
                || source.starts_with("ws://localhost:")
        });
        assert!(local_only, "devCsp {directive} adds more than Vite's local HMR: {value}");
    }
}

#[test]
fn security_only_style_src_skips_tauri_csp_hashing() {
    // Tauri adds hashes/nonces to the CSP; in style-src they would disable
    // 'unsafe-inline' and block React style attributes. script-src must keep them.
    let disabled = &tauri_config()["app"]["security"]["dangerousDisableAssetCspModification"];
    assert_eq!(disabled, &serde_json::json!(["style-src"]));
}

// --- A01 Broken access control --------------------------------------------

#[test]
fn security_webview_capabilities_are_minimal() {
    let text = fs::read_to_string(repo().join("src-tauri/capabilities/default.json")).unwrap();
    let capability: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(capability["windows"], serde_json::json!(["main"]));
    // No plugins at all (no fs, shell, http, process or opener): the UI
    // reaches the system only through KUI's own commands, which validate
    // their input.
    assert_eq!(capability["permissions"], serde_json::json!(["core:default"]));
    assert!(capability.get("remote").is_none(), "remote URLs must never get IPC access");
}

#[test]
fn security_no_remote_content_or_global_tauri() {
    let config = tauri_config();
    assert_ne!(config["app"]["withGlobalTauri"], Value::Bool(true), "exposes IPC to every script");
    let dist = config["build"]["frontendDist"].as_str().unwrap();
    assert!(!dist.starts_with("http"), "production must load the bundled UI, not {dist}");
}

// --- A03 Injection (DOM XSS) ----------------------------------------------

#[test]
fn security_ui_has_no_html_injection_sinks() {
    // React escapes text; these bypass it. Kafka message bodies are attacker-controlled.
    let sinks = [
        "dangerouslySetInnerHTML",
        ".innerHTML",
        ".outerHTML",
        "insertAdjacentHTML",
        "document.write",
        "eval(",
        "new Function(",
    ];
    for (path, text) in frontend_sources() {
        for sink in sinks {
            assert!(!text.contains(sink), "{} uses {sink}", path.display());
        }
    }
}

#[test]
fn security_links_never_navigate_the_app_window() {
    // An <a href> to message content could navigate the webview away from the app.
    for (path, text) in frontend_sources() {
        assert!(!text.contains("<a href={"), "{} links to dynamic content", path.display());
        assert!(!text.contains("window.location"), "{} navigates the window", path.display());
    }
}

// --- Behavioural controls tested next to their code -----------------------
//
// A01  internal topics are read-only ........ kafka::metadata::tests::platform_topics_are_internal
//                                             integration_tests::full_round_trip (refused batch delete)
// A02  secrets readable by the owner only ... json_file::tests::saved_files_are_readable_by_the_owner_only
//                                             clusters::store::tests::passwords_go_to_the_keychain_not_the_file

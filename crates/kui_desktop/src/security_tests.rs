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
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn tauri_config() -> Value {
    let text = fs::read_to_string(repo().join("crates/kui_desktop/tauri.conf.json")).unwrap();
    serde_json::from_str(&text).unwrap()
}

fn csp(key: &str) -> serde_json::Map<String, Value> {
    tauri_config()["app"]["security"][key]
        .as_object()
        .unwrap_or_else(|| panic!("app.security.{key} must be set (a null CSP allows anything)"))
        .clone()
}

/// Every .ts/.tsx file under `frontend/`, excluding tests.
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
    walk(&repo().join("frontend"), &mut out);
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
    let text = fs::read_to_string(repo().join("crates/kui_desktop/capabilities/default.json")).unwrap();
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

#[test]
fn security_ui_loads_nothing_from_dynamic_urls() {
    // Message content must never pick a URL: `javascript:` and `data:` schemes run code, and any remote
    // fetch from a message would also leak that the message was opened.
    let attributes = ["src={", "href={", "srcDoc", "<iframe", "<embed", "<object", "window.open"];
    for (path, text) in frontend_sources() {
        for attribute in attributes {
            assert!(!text.contains(attribute), "{} uses {attribute}", path.display());
        }
    }
}

// --- Behavioural controls tested next to their code -----------------------
//
// A01  internal topics are read-only ........ kui_kafka::metadata::tests::platform_topics_are_internal
//                                             integration_tests::full_round_trip (refused batch delete)
// A02  secrets readable by the owner only ... json_file::tests::saved_files_are_readable_by_the_owner_only
//                                             clusters::store::tests::passwords_go_to_the_keychain_not_the_file
//                                             clusters::store::tests::secret_properties_go_to_the_keychain_not_the_file
// A03  librdkafka cannot load code via props  kui_kafka::cluster::tests::dangerous_or_app_owned_properties_are_rejected
//                                             kui_kafka::client::tests::creating_clients_rejects_denied_properties
// A01  ids from IPC must name a cluster ..... clusters::store::tests::save_rejects_ids_that_do_not_exist
// A10  hostile header names cannot abort .... messages::headers::tests::non_utf8_header_name_is_decoded_lossily_instead_of_panicking
// A04  page memory is capped ................ messages::codec::tests::spent_budget_truncates_but_keeps_size_and_a_preview

/// Commands in `generate_handler!`, by function name.
fn registered_commands() -> Vec<String> {
    let lib = fs::read_to_string(repo().join("crates/kui_desktop/src/lib.rs")).unwrap();
    let body = lib.split("generate_handler![").nth(1).and_then(|rest| rest.split(']').next()).unwrap();
    body.split(',')
        .filter_map(|path| path.trim().rsplit("::").next())
        .filter(|name| !name.is_empty())
        .map(str::to_string)
        .collect()
}

/// Names in the `CHANGING_COMMANDS` array of the e2e helpers.
fn e2e_changing_commands() -> Vec<String> {
    let helpers = fs::read_to_string(repo().join("e2e/helpers.ts")).unwrap();
    let body = helpers.split("CHANGING_COMMANDS = [").nth(1).and_then(|rest| rest.split("];").next()).unwrap();
    body.split(',').map(|name| name.trim().trim_matches('"').to_string()).filter(|name| !name.is_empty()).collect()
}

/// Commands that never change a cluster or saved connections. A new command must be
/// classified here or in `CHANGING_COMMANDS`, so the "no unprompted changes" e2e
/// spec cannot pass vacuously for it (KUI-K07).
const READ_ONLY_COMMANDS: &[&str] = &[
    "load_settings",
    "save_setting",
    "check_for_update",
    "list_clusters",
    "test_connection",
    "cluster_overview",
    "list_topics",
    "topic_detail",
    "browse_messages",
    "tail_messages",
    "export_messages",
    "check_message_query",
    "list_generators",
    "preview_records",
    "cancel_task",
    "list_consumer_groups",
    "consumer_group_detail",
    "consumer_group_lags",
    "topic_consumer_groups",
    "preview_offset_reset",
];

#[test]
fn security_every_command_is_classified_for_the_no_unprompted_changes_spec() {
    let changing = e2e_changing_commands();
    let registered = registered_commands();
    assert!(registered.len() > 20 && changing.len() >= 8, "parsing broke: {registered:?} / {changing:?}");
    for name in &registered {
        assert!(
            changing.contains(name) || READ_ONLY_COMMANDS.contains(&name.as_str()),
            "`{name}` is in generate_handler! but neither in CHANGING_COMMANDS (e2e/helpers.ts) nor READ_ONLY_COMMANDS"
        );
    }
    for name in changing.iter().map(String::as_str).chain(READ_ONLY_COMMANDS.iter().copied()) {
        assert!(registered.iter().any(|r| r == name), "`{name}` is listed but no longer a registered command");
    }
    for name in READ_ONLY_COMMANDS {
        assert!(!changing.iter().any(|c| c == name), "`{name}` is both read-only and changing");
    }
}

#[test]
fn security_message_headers_never_go_through_rdkafkas_panicking_name_decoding() {
    // rdkafka unwraps a UTF-8 conversion of every header name; one hostile record aborts the app (KUI-K01).
    // Behaviour: messages::headers::tests::non_utf8_header_name_is_decoded_lossily_instead_of_panicking.
    let dir = repo().join("crates/kui_desktop/src/features");
    let mut files = Vec::new();
    fn walk(dir: &Path, out: &mut Vec<(PathBuf, String)>) {
        for entry in fs::read_dir(dir).unwrap().flatten() {
            let path = entry.path();
            if path.is_dir() {
                walk(&path, out);
            } else if path.extension().is_some_and(|e| e == "rs") {
                out.push((path.clone(), fs::read_to_string(&path).unwrap()));
            }
        }
    }
    walk(&dir, &mut files);
    for (path, text) in &files {
        let is_headers_module = path.ends_with("messages/headers.rs");
        // Without the `Headers` trait in scope, `iter`/`try_get`/`get` on rdkafka headers cannot be called.
        let imports_trait = text
            .lines()
            .filter(|line| line.contains("rdkafka::message"))
            .any(|line| line.split(|c: char| !c.is_alphanumeric() && c != '_').any(|word| word == "Headers"));
        assert!(
            is_headers_module || !imports_trait,
            "{}: use messages::headers::read, not the rdkafka `Headers` trait",
            path.display()
        );
        // The only unsafe code in the app is the raw header reader.
        assert!(
            is_headers_module || !text.contains("allow(unsafe_code)"),
            "{}: unsafe_code is denied; only messages/headers.rs may opt out",
            path.display()
        );
    }
}

// Purple team round 2: an old clusters.json with plaintext secret properties (IC-002, RA-003) and a
// planted file with an aliased denied property (RA-002).
#[test]
fn security_old_plaintext_secret_properties_and_aliases_migrate_to_the_keychain() {
    use crate::features::clusters::secrets::testing::MemoryKeychain;
    use crate::features::clusters::store::ClusterStore;

    let path = std::env::temp_dir().join(format!("kui-purple-{}.json", uuid::Uuid::new_v4()));
    let secret_keys = [
        "sasl.password",
        "ssl.key.password",
        "ssl.keystore.password",
        "ssl.key.pem",
        "sasl.oauthbearer.client.secret",
        "sasl.oauthbearer.client.credentials.client.secret",
        "sasl.oauthbearer.config",
        "sasl.oauthbearer.assertion.private.key.pem",
        "sasl.oauthbearer.assertion.private.key.passphrase",
        "SASL.OAuthBearer.Client.Credentials.Client.Secret ",
    ];
    let mut props = serde_json::Map::new();
    for (i, key) in secret_keys.iter().enumerate() {
        props.insert((*key).into(), format!("PLAINTEXT-SECRET-{i}").into());
    }
    props.insert("ssl.ca.location".into(), "/ca.pem".into());
    let old = serde_json::json!([{
        "id": "old-id", "name": "old", "bootstrapServers": "h:9092",
        "saslPassword": "PLAINTEXT-SASL", "oauthClientSecret": "PLAINTEXT-OAUTH", "sslKeyPassword": "PLAINTEXT-KEY",
        "properties": props,
    }]);
    fs::write(&path, old.to_string()).unwrap();

    let keychain = MemoryKeychain::default();
    let store = ClusterStore::load(path.clone(), Box::new(keychain.clone())).unwrap();
    let on_disk = fs::read_to_string(&path).unwrap();
    assert!(!on_disk.contains("PLAINTEXT-"), "secret left in clusters.json: {on_disk}");
    assert!(on_disk.contains("/ca.pem"));
    let in_keychain = keychain.0.lock().unwrap()["old-id"].clone();
    for (i, key) in secret_keys.iter().enumerate() {
        assert!(in_keychain.contains(&format!("PLAINTEXT-SECRET-{i}")), "{key} not in keychain");
    }
    // The cluster still connects with every secret restored in memory.
    let back = store.get("old-id").unwrap();
    assert_eq!(back.properties.len(), secret_keys.len() + 1);
    assert_eq!(back.sasl_password.as_deref(), Some("PLAINTEXT-SASL"));
    let debug = format!("{back:?} {back:#?}");
    assert!(!debug.contains("PLAINTEXT-"), "Debug leaked: {debug}");

    // Second load from the migrated file + keychain: same result.
    let again = ClusterStore::load(path.clone(), Box::new(keychain)).unwrap();
    assert_eq!(again.get("old-id").unwrap().properties.len(), secret_keys.len() + 1);
    fs::remove_file(path).ok();
}

#[test]
fn security_planted_alias_properties_cannot_reach_a_client() {
    for key in ["metadata.broker.list", "auto.commit.enable", "Metadata.Broker.List", "\tgroup.id\n"] {
        let cluster: kui_kafka::ClusterConfig = serde_json::from_value(serde_json::json!({
            "name": "planted", "bootstrapServers": "localhost:1", "properties": { key: "x" },
        }))
        .unwrap();
        assert!(kui_kafka::KafkaClients::connect(cluster.clone()).is_err(), "connect accepted {key:?}");
        assert!(kui_kafka::new_consumer(&cluster, "g").is_err(), "new_consumer accepted {key:?}");
        assert!(crate::features::clusters::service::test_connection(&cluster).is_err(), "test_connection {key:?}");
    }
}

#[test]
fn security_ui_truncated_payloads_cannot_be_copied_and_say_so() {
    // RA-001 UI half has no component tests; this fails if the guards are removed from the views.
    let dir = repo().join("frontend/features/messages/components");
    let read = |name: &str| fs::read_to_string(dir.join(name)).unwrap();
    let (sheet, table, tabs) = (read("message-sheet.tsx"), read("message-table.tsx"), read("payload-view-tabs.tsx"));
    assert!(sheet.contains("disabled={payload.truncated}"), "detail sheet Copy must be disabled for a cut payload");
    assert!(table.contains("payload.truncated ?") && table.contains("disabled"), "row preview copy must be guarded");
    for view in [&sheet, &table] {
        assert!(view.contains("<TruncationNotice payload={payload}"), "a cut payload must show the notice");
    }
    assert!(tabs.contains("truncationNotice(payload)"));
}

//! KUI — a desktop GUI for Apache Kafka.
//!
//! This file only wires things together. Read a feature in `features/<name>/`
//! starting from `commands.rs` (the entry points the UI calls).

mod blocking;
mod error;
mod features;
mod json_file;
mod kafka;
mod settings;
mod state;
mod tasks;
mod updates;

#[cfg(test)]
mod integration_tests;
#[cfg(test)]
mod security_tests;

use tauri::Manager;

use features::{brokers, clusters, consumer_groups, generator, messages, topics};
use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(updates::PendingUpdate::default())
        .setup(|app| {
            let config_dir = app.path().app_config_dir()?;
            let store = clusters::store::ClusterStore::load(config_dir.join("clusters.json"))?;
            app.manage(AppState::new(store));
            app.manage(settings::SettingsStore::load(config_dir.join("settings.json"))?);
            // The version comes from package.json (via tauri.conf.json), so the title never drifts.
            if let Some(window) = app.get_webview_window("main") {
                window.set_title(&format!("KUI v{}", app.package_info().version))?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            settings::load_settings,
            settings::save_setting,
            updates::check_for_update,
            updates::install_update,
            clusters::commands::list_clusters,
            clusters::commands::save_cluster,
            clusters::commands::delete_cluster,
            clusters::commands::test_connection,
            brokers::commands::cluster_overview,
            topics::commands::list_topics,
            topics::commands::topic_detail,
            topics::commands::create_topic,
            topics::commands::delete_topics,
            messages::commands::browse_messages,
            messages::commands::produce_message,
            messages::commands::copy_messages,
            messages::commands::tail_messages,
            generator::commands::list_generators,
            generator::commands::preview_records,
            generator::commands::generate_records,
            tasks::cancel_task,
            consumer_groups::commands::list_consumer_groups,
            consumer_groups::commands::consumer_group_detail,
            consumer_groups::commands::consumer_group_lags,
            consumer_groups::commands::topic_consumer_groups,
            consumer_groups::commands::delete_consumer_group,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

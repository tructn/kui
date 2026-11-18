//! KUI — a desktop GUI for Apache Kafka.
//!
//! This file only wires things together. Read a feature in `features/<name>/`
//! starting from `commands.rs` (the entry points the UI calls).

mod blocking;
mod error;
mod features;
mod json_file;
mod lock;
mod secret_store;
mod settings;
mod state;
mod tasks;
mod tray;
mod updates;

#[cfg(test)]
mod integration_tests;
#[cfg(test)]
mod security_tests;

use std::sync::{Arc, Mutex};

use tauri::Manager;

use features::automations::{self, AutomationStore, Engine};
use features::{brokers, clusters, consumer_groups, generator, messages, topics};
use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .manage(updates::PendingUpdate::default())
        .setup(|app| {
            let config_dir = app.path().app_config_dir()?;
            let store = clusters::store::ClusterStore::load(
                config_dir.join("clusters.json"),
                Box::new(clusters::secrets::Keychain),
            )?;
            app.manage(AppState::new(store));
            app.manage(settings::SettingsStore::load(config_dir.join("settings.json"))?);

            let handle = app.handle().clone();
            let engine = Engine::http(Arc::new(move |cluster_id| handle.state::<AppState>().clients(cluster_id)))?;
            let automations =
                AutomationStore::load(config_dir.join("automations.json"), Box::new(secret_store::Keychain))?;
            for automation in automations.list().iter().filter(|a| a.enabled) {
                engine.start(automation);
            }
            app.manage(engine);
            app.manage(Mutex::new(automations));
            tray::install(app.handle())?;
            // The version comes from package.json (via tauri.conf.json), so the title never drifts.
            if let Some(window) = app.get_webview_window("main") {
                window.set_title(&format!("KUI v{}", app.package_info().version))?;
                // Created hidden and laid out here: window managers don't reliably honour `maximized` from the
                // config, and centring first means un-maximizing lands the window in the middle of the screen.
                window.center()?;
                window.maximize()?;
                window.show()?;
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // Keep running automations alive in the tray instead of quitting with the window.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event
                && window.label() == "main"
                && window.app_handle().state::<Engine>().running() > 0
            {
                api.prevent_close();
                let _ = window.hide();
            }
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
            messages::commands::export_messages,
            messages::commands::check_message_query,
            generator::commands::list_generators,
            generator::commands::preview_records,
            generator::commands::generate_records,
            tasks::cancel_task,
            consumer_groups::commands::list_consumer_groups,
            consumer_groups::commands::consumer_group_detail,
            consumer_groups::commands::consumer_group_lags,
            consumer_groups::commands::topic_consumer_groups,
            consumer_groups::commands::delete_consumer_group,
            consumer_groups::commands::preview_offset_reset,
            consumer_groups::commands::reset_consumer_group_offsets,
            automations::commands::list_automations,
            automations::commands::save_automation,
            automations::commands::set_automation_enabled,
            automations::commands::delete_automation,
            automations::commands::automation_statuses,
            automations::commands::test_automation,
            automations::commands::preview_automation_body,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, _event| {
            // Clicking the Dock icon brings back a window hidden in the tray.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = _event {
                tray::show_window(_app);
            }
        });
}

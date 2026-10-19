import type { PersistStorage, StorageValue } from "zustand/middleware";

import { callCommand } from "./invoke";

/**
 * Storage for zustand's `persist` middleware, backed by `settings.json` in the
 * app config directory (see `src-tauri/src/settings.rs`) instead of the
 * webview's localStorage, which can lose recent writes when the app quits.
 *
 * `loadSettings()` must finish before any persisted store is created (see
 * `main.tsx`). After that, reads are synchronous from memory, so stores hydrate
 * immediately and the first render already has the saved theme and fonts.
 * Writes update memory right away and are sent to Rust one at a time, in order.
 *
 *   persist(..., { name: "kui.theme", storage: settingsStorage() })
 */
let settings: Record<string, unknown> = {};

export async function loadSettings(): Promise<void> {
  try {
    settings = await callCommand<Record<string, unknown>>("load_settings");
  } catch (error) {
    console.error("Could not load settings; using defaults", error);
  }
  migrateFromLocalStorage();
}

export function settingsStorage<S>(): PersistStorage<S> {
  return {
    getItem: (name) => (settings[name] as StorageValue<S> | undefined) ?? null,
    setItem: (name, value) => write(name, value),
    removeItem: (name) => write(name, null),
  };
}

/** The last save sent to Rust. */
let saving: Promise<unknown> = Promise.resolve();

function write(key: string, value: unknown) {
  if (value === null) delete settings[key];
  else settings[key] = value;
  // `save_setting` is async in Rust, so two saves in flight could finish out
  // of order and leave an older value on disk. Send the next only after the last.
  saving = saving.then(() =>
    callCommand("save_setting", { key, value }).catch((error) =>
      console.error(`Could not save setting ${key}`, error),
    ),
  );
}

/** Keys earlier versions persisted to localStorage, before settings moved to a file. */
const LEGACY_KEYS = ["kui.theme", "kui.appearance", "kui.navigation"];

/** Copies settings saved by earlier versions over, once. */
function migrateFromLocalStorage() {
  for (const key of LEGACY_KEYS) {
    if (key in settings) continue;
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) continue;
      write(key, JSON.parse(raw));
      localStorage.removeItem(key);
    } catch (error) {
      console.error(`Could not migrate setting ${key} from localStorage`, error);
    }
  }
}

import { invoke } from "@tauri-apps/api/core";

declare global {
  interface Window {
    /** Commands the UI has sent, in order. Only in e2e builds (VITE_E2E=1). */
    __KUI_COMMANDS__?: string[];
  }
}

/**
 * Calls a Rust `#[tauri::command]`.
 *
 * Rust errors arrive as plain strings (see `src-tauri/src/error.rs`);
 * this wraps them in `Error` so the UI can always read `error.message`.
 */
export async function callCommand<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  // Lets the e2e suite check that browsing never sends a command that changes anything.
  // Vite inlines the flag, so release builds drop this line.
  if (import.meta.env.VITE_E2E) (window.__KUI_COMMANDS__ ??= []).push(command);
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw new Error(typeof error === "string" ? error : String(error));
  }
}

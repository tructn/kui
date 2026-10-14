import { invoke } from "@tauri-apps/api/core";

/**
 * Calls a Rust `#[tauri::command]`.
 *
 * Rust errors arrive as plain strings (see `src-tauri/src/error.rs`);
 * this wraps them in `Error` so the UI can always read `error.message`.
 */
export async function callCommand<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw new Error(typeof error === "string" ? error : String(error));
  }
}

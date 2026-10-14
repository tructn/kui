import { Channel } from "@tauri-apps/api/core";

import { callCommand } from "./invoke";

export interface StreamTask<R> {
  /** Settles when the Rust command returns (finished, cancelled or failed). */
  result: Promise<R>;
  /** Asks Rust to stop; `result` then settles normally. */
  cancel: () => Promise<void>;
}

/**
 * Starts a long-running Rust command that pushes updates through a Tauri `Channel`
 * (live tail, data generation). See `src-tauri/src/tasks.rs`.
 *
 * We pick the task id here so `cancel` works immediately, even before Rust replies.
 */
export function startStream<T, R = void>(
  command: string,
  args: Record<string, unknown>,
  onMessage: (message: T) => void,
): StreamTask<R> {
  const taskId = crypto.randomUUID();
  const channel = new Channel<T>();
  channel.onmessage = onMessage;
  return {
    result: callCommand<R>(command, { ...args, taskId, channel }),
    cancel: () => callCommand<boolean>("cancel_task", { taskId }).then(() => undefined),
  };
}

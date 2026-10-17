import { useEffect, useState } from "react";

import { messagesApi } from "./api";
import type { KafkaMessage } from "./types";

/** Live mode keeps only this many messages so a busy topic can't exhaust memory. */
export const LIVE_LIMIT = 1000;

/**
 * Streams new messages while `enabled`, newest first.
 *
 * This is streaming state, not cached server state, so it lives in a hook
 * instead of React Query. Turning it off (or unmounting) stops the Rust consumer.
 */
export function useLiveTail(clusterId: string, topic: string, partition: number | null, enabled: boolean) {
  const [messages, setMessages] = useState<KafkaMessage[]>([]);
  const [received, setReceived] = useState(0);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!enabled) return;
    setMessages([]);
    setReceived(0);
    setError(null);
    const task = messagesApi.tail(clusterId, { topic, partition }, (batch) => {
      setReceived((n) => n + batch.length);
      setMessages((previous) => [...batch.reverse(), ...previous].slice(0, LIVE_LIMIT));
    });
    task.result.catch(setError);
    return () => void task.cancel();
  }, [clusterId, topic, partition, enabled]);

  return { messages, received, error };
}

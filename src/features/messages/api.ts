// Mirrors `src-tauri/src/features/messages/commands.rs`.
import { callCommand } from "@/lib/invoke";
import { startStream } from "@/lib/stream";

import type { BrowsePage, BrowseRequest, CopyRequest, Delivered, KafkaMessage, ProduceRequest, TailRequest } from "./types";

export const messagesApi = {
  browse: (clusterId: string, request: BrowseRequest) =>
    callCommand<BrowsePage>("browse_messages", { clusterId, request }),
  produce: (clusterId: string, request: ProduceRequest) =>
    callCommand<Delivered>("produce_message", { clusterId, request }),
  copy: (clusterId: string, request: CopyRequest) =>
    callCommand<Delivered[]>("copy_messages", { clusterId, request }),
  /** Streams new messages in batches until cancelled. */
  tail: (clusterId: string, request: TailRequest, onBatch: (batch: KafkaMessage[]) => void) =>
    startStream<KafkaMessage[]>("tail_messages", { clusterId, request }, onBatch),
};

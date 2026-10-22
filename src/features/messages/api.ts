// Mirrors `src-tauri/src/features/messages/commands.rs`.
import { callCommand } from "@/lib/invoke";
import { startStream } from "@/lib/stream";

import type {
  BrowsePage,
  BrowseRequest,
  CopyRequest,
  Delivered,
  Exported,
  ExportRequest,
  KafkaMessage,
  ProduceRequest,
  TailRequest,
} from "./types";

export const messagesApi = {
  browse: (clusterId: string, request: BrowseRequest) =>
    callCommand<BrowsePage>("browse_messages", { clusterId, request }),
  produce: (clusterId: string, request: ProduceRequest) =>
    callCommand<Delivered>("produce_message", { clusterId, request }),
  copy: (clusterId: string, request: CopyRequest) =>
    callCommand<Delivered[]>("copy_messages", { clusterId, request }),
  /** Asks where to save, then writes the file. null when the user cancels the save window. */
  export: (clusterId: string, request: ExportRequest) =>
    callCommand<Exported | null>("export_messages", { clusterId, request }),
  /** Streams new messages in batches until cancelled. */
  tail: (clusterId: string, request: TailRequest, onBatch: (batch: KafkaMessage[]) => void) =>
    startStream<KafkaMessage[]>("tail_messages", { clusterId, request }, onBatch),
};

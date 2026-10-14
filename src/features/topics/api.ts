// Mirrors `src-tauri/src/features/topics/commands.rs`.
import { callCommand } from "@/lib/invoke";

import type { DeleteTopicResult, NewTopicRequest, TopicDetail, TopicSummary } from "./types";

export const topicsApi = {
  list: (clusterId: string) => callCommand<TopicSummary[]>("list_topics", { clusterId }),
  detail: (clusterId: string, topic: string) => callCommand<TopicDetail>("topic_detail", { clusterId, topic }),
  create: (clusterId: string, request: NewTopicRequest) => callCommand<void>("create_topic", { clusterId, request }),
  removeMany: (clusterId: string, topics: string[]) =>
    callCommand<DeleteTopicResult[]>("delete_topics", { clusterId, topics }),
};

// Mirrors `src-tauri/src/features/consumer_groups/commands.rs`.
import { callCommand } from "@/lib/invoke";

import type { GroupDetail, GroupLag, GroupSummary, TopicConsumer } from "./types";

export const consumerGroupsApi = {
  list: (clusterId: string) => callCommand<GroupSummary[]>("list_consumer_groups", { clusterId }),
  lags: (clusterId: string) => callCommand<GroupLag[]>("consumer_group_lags", { clusterId }),
  detail: (clusterId: string, group: string) =>
    callCommand<GroupDetail>("consumer_group_detail", { clusterId, group }),
  topicConsumers: (clusterId: string, topic: string) =>
    callCommand<TopicConsumer[]>("topic_consumer_groups", { clusterId, topic }),
  remove: (clusterId: string, group: string) => callCommand<void>("delete_consumer_group", { clusterId, group }),
};

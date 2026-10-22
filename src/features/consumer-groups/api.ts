// Mirrors `src-tauri/src/features/consumer_groups/commands.rs`.
import { callCommand } from "@/lib/invoke";

import type { GroupDetail, GroupLag, GroupSummary, OffsetChange, ResetRequest, TopicConsumer } from "./types";

export const consumerGroupsApi = {
  list: (clusterId: string) => callCommand<GroupSummary[]>("list_consumer_groups", { clusterId }),
  lags: (clusterId: string) => callCommand<GroupLag[]>("consumer_group_lags", { clusterId }),
  detail: (clusterId: string, group: string) =>
    callCommand<GroupDetail>("consumer_group_detail", { clusterId, group }),
  topicConsumers: (clusterId: string, topic: string) =>
    callCommand<TopicConsumer[]>("topic_consumer_groups", { clusterId, topic }),
  remove: (clusterId: string, group: string) => callCommand<void>("delete_consumer_group", { clusterId, group }),
  /** What a reset would change; changes nothing. */
  previewReset: (clusterId: string, request: ResetRequest) =>
    callCommand<OffsetChange[]>("preview_offset_reset", { clusterId, request }),
  resetOffsets: (clusterId: string, request: ResetRequest) =>
    callCommand<OffsetChange[]>("reset_consumer_group_offsets", { clusterId, request }),
};

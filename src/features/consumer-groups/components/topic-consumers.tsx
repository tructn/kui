import { RotateCwIcon } from "lucide-react";

import { ErrorState, LoadingRows } from "@/components/query-states";
import { Button } from "@/components/ui/button";

import { useTopicConsumers } from "../queries";
import { GroupStateBadge } from "./group-state-badge";
import { ProgressLegend } from "./progress-bar";
import { ProgressSection } from "./progress-section";

/** Every consumer group reading `topic`, and how far each has read every partition. */
export function TopicConsumers({ clusterId, topic }: { clusterId: string; topic: string }) {
  const consumers = useTopicConsumers(clusterId, topic);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto pt-2">
      <div className="flex items-center justify-between gap-2">
        <ProgressLegend />
        <Button variant="ghost" size="icon-sm" aria-label="Refresh consumers" onClick={() => consumers.refetch()}>
          <RotateCwIcon className={consumers.isFetching ? "animate-spin" : undefined} />
        </Button>
      </div>
      {consumers.error && <ErrorState error={consumers.error} onRetry={() => consumers.refetch()} />}
      {consumers.isPending && <LoadingRows rows={3} />}
      {consumers.data?.length === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground">No consumer group has read this topic yet.</p>
      )}
      {consumers.data?.map((c) => (
        <ProgressSection
          key={c.group}
          title={c.group}
          progress={c.progress}
          offsets={c.offsets}
          defaultOpen={consumers.data.length === 1}
          extra={
            <>
              <GroupStateBadge state={c.state} />
              <span className="text-xs text-muted-foreground">
                {c.members} {c.members === 1 ? "member" : "members"}
              </span>
            </>
          }
        />
      ))}
    </div>
  );
}

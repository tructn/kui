import { ArrowLeftIcon, RotateCwIcon } from "lucide-react";

import { useClusterId, useNavigation } from "@/app/stores/navigation-store";
import { CopyButton } from "@/components/copy-button";
import { PageHeader } from "@/components/page-header";
import { ErrorState, LoadingRows } from "@/components/query-states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TopicConsumers } from "@/features/consumer-groups";
import { GenerateDialog } from "@/features/generator";
import { MessageBrowser, ProduceDialog } from "@/features/messages";
import { formatNumber } from "@/lib/format";

import { useTopic, useTopics } from "../queries";
import { ConfigsTable } from "./configs-table";
import { DeleteTopicButton } from "./delete-topic-button";
import { PartitionsTable } from "./partitions-table";

/** One topic: messages, partitions and configuration in tabs. */
export function TopicPage({ topic }: { topic: string }) {
  const clusterId = useClusterId();
  const navigate = useNavigation((s) => s.navigate);
  const detail = useTopic(clusterId, topic);
  const topics = useTopics(clusterId);
  const backToList = () => navigate({ page: "topics" });

  const partitionIds = detail.data?.partitions.map((p) => p.id) ?? [];
  const copyTargets = (topics.data ?? [])
    .filter((t) => !t.internal)
    .map((t) => ({ name: t.name, partitions: t.partitions }));
  const messageCount = detail.data?.partitions.reduce(
    (sum, p) => sum + p.high - p.low,
    0,
  );
  // Platform topics (__consumer_offsets, _connect-configs, …) are read-only.
  const internal = detail.data?.internal ?? false;

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Back to topics"
              onClick={backToList}
            >
              <ArrowLeftIcon />
            </Button>
            <span className="font-mono">{topic}</span>
            <CopyButton value={topic} label="Copy topic name" />
            {internal && (
              <Badge
                variant="outline"
                title="Used by Kafka or a tool around it; KUI never writes to or deletes it"
              >
                internal · read-only
              </Badge>
            )}
          </span>
        }
        description={
          detail.data &&
          `${partitionIds.length} partitions · ${formatNumber(messageCount ?? 0)} messages`
        }
        actions={
          <>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Refresh"
              onClick={() => detail.refetch()}
            >
              <RotateCwIcon
                className={detail.isFetching ? "animate-spin" : undefined}
              />
            </Button>
            {detail.data && !internal && (
              <>
                <DeleteTopicButton
                  clusterId={clusterId}
                  topic={topic}
                  onDeleted={backToList}
                />
                <GenerateDialog
                  clusterId={clusterId}
                  topic={topic}
                  partitions={partitionIds}
                />
                <ProduceDialog
                  clusterId={clusterId}
                  topic={topic}
                  partitions={partitionIds}
                />
              </>
            )}
          </>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col p-4">
        {detail.error && (
          <ErrorState error={detail.error} onRetry={() => detail.refetch()} />
        )}
        {detail.isPending && <LoadingRows />}
        {detail.data && (
          <Tabs defaultValue="messages" className="min-h-0 flex-1">
            <TabsList>
              <TabsTrigger value="messages">Messages</TabsTrigger>
              <TabsTrigger value="consumers">Consumers</TabsTrigger>
              <TabsTrigger value="partitions">Partitions</TabsTrigger>
              <TabsTrigger value="configuration">Configuration</TabsTrigger>
            </TabsList>
            <TabsContent value="messages" className="flex min-h-0 flex-col">
              <MessageBrowser
                clusterId={clusterId}
                topic={topic}
                partitions={partitionIds}
                copyTargets={copyTargets}
                readOnly={internal}
              />
            </TabsContent>
            <TabsContent value="consumers" className="flex min-h-0 flex-col">
              <TopicConsumers clusterId={clusterId} topic={topic} />
            </TabsContent>
            <TabsContent value="partitions" className="flex min-h-0 flex-col">
              <PartitionsTable partitions={detail.data.partitions} />
            </TabsContent>
            <TabsContent
              value="configuration"
              className="flex min-h-0 flex-col"
            >
              <ConfigsTable configs={detail.data.configs} />
            </TabsContent>
          </Tabs>
        )}
      </div>
    </>
  );
}

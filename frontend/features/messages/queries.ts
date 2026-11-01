import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { clusterKeys } from "@/features/clusters";

import { messagesApi } from "./api";
import type { BrowseRequest, CopyRequest, ExportRequest, ProduceRequest } from "./types";

export const messageKeys = {
  topic: (clusterId: string, topic: string) => [...clusterKeys.scope(clusterId), "messages", topic] as const,
  browse: (clusterId: string, request: BrowseRequest) =>
    [...messageKeys.topic(clusterId, request.topic), request] as const,
};

export function useBrowseMessages(clusterId: string, request: BrowseRequest) {
  return useQuery({
    queryKey: messageKeys.browse(clusterId, request),
    queryFn: () => messagesApi.browse(clusterId, request),
    // Messages change constantly; always re-read when asked.
    staleTime: 0,
    // Keep showing the current page while the next one loads.
    placeholderData: keepPreviousData,
  });
}

/** How many recent messages are read to learn a topic's fields for query suggestions. */
const SAMPLE_SIZE = 500;

/** The newest messages of a topic, read once the query bar is first used. */
export function useMessageSample(clusterId: string, topic: string, enabled: boolean) {
  return useQuery({
    queryKey: [...messageKeys.topic(clusterId, topic), "sample"],
    queryFn: () =>
      messagesApi.browse(clusterId, {
        topic,
        partition: null,
        from: "latest",
        value: null,
        query: null,
        pageSize: SAMPLE_SIZE,
        cursor: null,
      }),
    enabled,
    staleTime: 60_000,
  });
}

export function useProduceMessage(clusterId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: ProduceRequest) => messagesApi.produce(clusterId, request),
    // Refresh this topic's message list (and any counts) after producing.
    onSuccess: (_, request) =>
      queryClient.invalidateQueries({ queryKey: messageKeys.topic(clusterId, request.topic) }),
  });
}

export function useCopyMessages(clusterId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: CopyRequest) => messagesApi.copy(clusterId, request),
    // The target gained messages.
    onSuccess: (_, request) =>
      queryClient.invalidateQueries({ queryKey: messageKeys.topic(clusterId, request.targetTopic) }),
  });
}

export function useExportMessages(clusterId: string) {
  return useMutation({
    mutationFn: (request: ExportRequest) => messagesApi.export(clusterId, request),
  });
}

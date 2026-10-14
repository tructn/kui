import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { clusterKeys } from "@/features/clusters";

import { consumerGroupsApi } from "./api";

export const groupKeys = {
  all: (clusterId: string) => [...clusterKeys.scope(clusterId), "groups"] as const,
  lags: (clusterId: string) => [...groupKeys.all(clusterId), "$lags"] as const,
  detail: (clusterId: string, group: string) => [...groupKeys.all(clusterId), group] as const,
  topic: (clusterId: string, topic: string) => [...groupKeys.all(clusterId), "$topic", topic] as const,
};

export function useConsumerGroups(clusterId: string) {
  return useQuery({
    queryKey: groupKeys.all(clusterId),
    queryFn: () => consumerGroupsApi.list(clusterId),
  });
}

/** Lag of every group; slower than the list, so pages show it when it arrives. */
export function useConsumerGroupLags(clusterId: string, options?: { refetchInterval?: number }) {
  return useQuery({
    queryKey: groupKeys.lags(clusterId),
    queryFn: () => consumerGroupsApi.lags(clusterId),
    refetchInterval: options?.refetchInterval,
  });
}

export function useConsumerGroup(clusterId: string, group: string | null) {
  return useQuery({
    queryKey: groupKeys.detail(clusterId, group ?? ""),
    queryFn: () => consumerGroupsApi.detail(clusterId, group!),
    enabled: group != null,
  });
}

export function useTopicConsumers(clusterId: string, topic: string) {
  return useQuery({
    queryKey: groupKeys.topic(clusterId, topic),
    queryFn: () => consumerGroupsApi.topicConsumers(clusterId, topic),
  });
}

export function useDeleteConsumerGroup(clusterId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (group: string) => consumerGroupsApi.remove(clusterId, group),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: groupKeys.all(clusterId) }),
  });
}

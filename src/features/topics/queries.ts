import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { clusterKeys } from "@/features/clusters";

import { topicsApi } from "./api";
import type { NewTopicRequest } from "./types";

export const topicKeys = {
  all: (clusterId: string) => [...clusterKeys.scope(clusterId), "topics"] as const,
  detail: (clusterId: string, topic: string) => [...topicKeys.all(clusterId), topic] as const,
};

export function useTopics(clusterId: string, enabled = true) {
  return useQuery({ queryKey: topicKeys.all(clusterId), queryFn: () => topicsApi.list(clusterId), enabled });
}

/** Errors a topic reports for a moment after it's created, while partition leaders are elected. */
const LEADER_ELECTION = /NotLeader|LeaderNotAvailable|UnknownTopicOrPart/;

export function useTopic(clusterId: string, topic: string) {
  return useQuery({
    queryKey: topicKeys.detail(clusterId, topic),
    queryFn: () => topicsApi.detail(clusterId, topic),
    // Retries are off app-wide, but a just-created topic is worth waiting a few seconds for.
    retry: (failures, error) => failures < 8 && LEADER_ELECTION.test(error.message),
    retryDelay: 750,
  });
}

export function useCreateTopic(clusterId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: NewTopicRequest) => topicsApi.create(clusterId, request),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: topicKeys.all(clusterId) }),
  });
}

export function useDeleteTopic(clusterId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (topic: string) => {
      const [result] = await topicsApi.removeMany(clusterId, [topic]);
      if (result?.error) throw new Error(`Delete ${topic} failed: ${result.error}`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: topicKeys.all(clusterId) }),
  });
}

/** Resolves with one result per topic; some may have failed while others were deleted. */
export function useDeleteTopics(clusterId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (topics: string[]) => topicsApi.removeMany(clusterId, topics),
    // Refresh even after a partial failure: some topics are gone.
    onSettled: () => queryClient.invalidateQueries({ queryKey: topicKeys.all(clusterId) }),
  });
}

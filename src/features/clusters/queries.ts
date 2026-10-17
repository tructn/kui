import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { clustersApi } from "./api";

export const clusterKeys = {
  all: ["clusters"] as const,
  /** Prefix for every query that belongs to one cluster (topics, groups, ...). */
  scope: (clusterId: string) => ["cluster", clusterId] as const,
};

export function useClusters() {
  return useQuery({ queryKey: clusterKeys.all, queryFn: clustersApi.list, staleTime: Infinity });
}

export function useSaveCluster() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: clustersApi.save,
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: clusterKeys.all });
      // Connection settings may have changed: drop everything cached for this cluster.
      queryClient.removeQueries({ queryKey: clusterKeys.scope(saved.id) });
    },
  });
}

export function useDeleteCluster() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: clustersApi.remove,
    onSuccess: (_, clusterId) => {
      queryClient.invalidateQueries({ queryKey: clusterKeys.all });
      queryClient.removeQueries({ queryKey: clusterKeys.scope(clusterId) });
    },
  });
}

export function useTestConnection() {
  return useMutation({ mutationFn: clustersApi.testConnection });
}

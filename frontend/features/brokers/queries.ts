import { useQuery } from "@tanstack/react-query";

import { clusterKeys } from "@/features/clusters";

import { brokersApi } from "./api";

export const brokerKeys = {
  overview: (clusterId: string) => [...clusterKeys.scope(clusterId), "overview"] as const,
};

export function useClusterOverview(clusterId: string) {
  return useQuery({
    queryKey: brokerKeys.overview(clusterId),
    queryFn: () => brokersApi.overview(clusterId),
  });
}

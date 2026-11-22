import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { clusterKeys } from "@/features/clusters";

import { aclsApi } from "./api";
import type { AclBinding } from "./types";

export const aclKeys = {
  all: (clusterId: string) => [...clusterKeys.scope(clusterId), "acls"] as const,
};

export function useAcls(clusterId: string) {
  return useQuery({
    queryKey: aclKeys.all(clusterId),
    queryFn: () => aclsApi.list(clusterId),
  });
}

export function useCreateAcls(clusterId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (acls: AclBinding[]) => aclsApi.create(clusterId, acls),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: aclKeys.all(clusterId) }),
  });
}

export function useDeleteAcls(clusterId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (acls: AclBinding[]) => aclsApi.remove(clusterId, acls),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: aclKeys.all(clusterId) }),
  });
}

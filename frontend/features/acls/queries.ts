import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { clusterKeys } from "@/features/clusters";

import { aclsApi } from "./api";
import type { Acl } from "./types";

export const aclKeys = {
  all: (clusterId: string) => [...clusterKeys.scope(clusterId), "acls"] as const,
};

export function useAcls(clusterId: string) {
  return useQuery({ queryKey: aclKeys.all(clusterId), queryFn: () => aclsApi.list(clusterId) });
}

export function useCreateAcl(clusterId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (acl: Acl) => aclsApi.create(clusterId, acl),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: aclKeys.all(clusterId) }),
  });
}

export function useDeleteAcl(clusterId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (acl: Acl) => aclsApi.remove(clusterId, acl),
    // Refresh on failure too: "no matching ACL" means the list is out of date.
    onSettled: () => queryClient.invalidateQueries({ queryKey: aclKeys.all(clusterId) }),
  });
}

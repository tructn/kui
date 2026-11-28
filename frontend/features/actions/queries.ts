import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { clusterKeys } from "@/features/clusters";

import { actionsApi } from "./api";
import { isActive } from "./draft";
import type { Action, LambdaRuntime, RunStatus } from "./types";

/** How often running Actions refresh their status and history. */
const LIVE_INTERVAL = 1000;

export const actionKeys = {
  all: (clusterId: string) => [...clusterKeys.scope(clusterId), "actions"] as const,
  statuses: (clusterId: string) => [...actionKeys.all(clusterId), "$statuses"] as const,
  // Run logs live outside the cluster scope: refreshing a cluster doesn't touch them.
  history: (actionId: string) => ["actions", actionId, "history"] as const,
  execution: (actionId: string, executionId: number) => ["actions", actionId, "execution", executionId] as const,
  endpoint: (endpoint: string, runtime: LambdaRuntime) => ["actions", "endpoint", runtime, endpoint] as const,
  discovery: (projectDir: string) => ["actions", "discovery", projectDir] as const,
  send: ["actions", "send"] as const,
};

/** One message, picked in the message table, on its way to an Action's target. */
export interface SendRequest {
  action: Action;
  partition: number;
  offset: number;
}

export function useActions(clusterId: string) {
  return useQuery({ queryKey: actionKeys.all(clusterId), queryFn: () => actionsApi.list(clusterId) });
}

/** The Actions that read `topic`, which are the ones its messages can be sent to. */
export function useTopicActions(clusterId: string, topic: string): Action[] {
  const actions = useActions(clusterId);
  return (actions.data ?? []).filter((a) => a.source.topic === topic);
}

/**
 * Sends one message under `actionKeys.send`, so `SendResultSheet` follows it from anywhere. The Action
 * shows as running while it waits, so its status and history refresh when it's done.
 */
export function useSendToAction(clusterId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: actionKeys.send,
    mutationFn: ({ action, partition, offset }: SendRequest) => actionsApi.sendOne(action.id, partition, offset),
    onSettled: (_detail, _error, { action }) =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: actionKeys.statuses(clusterId) }),
        queryClient.invalidateQueries({ queryKey: actionKeys.history(action.id) }),
      ]),
  });
}

/** Polls while any Action is between Start and stopped, then goes quiet. */
export function useActionStatuses(clusterId: string | null) {
  return useQuery({
    queryKey: actionKeys.statuses(clusterId ?? ""),
    queryFn: () => actionsApi.statuses(clusterId ?? ""),
    enabled: clusterId != null,
    refetchInterval: (query) => (anyActive(query.state.data) ? LIVE_INTERVAL : false),
  });
}

/** For the sidebar's "running" dot. */
export function useRunningActionCount(clusterId: string | null): number {
  const statuses = useActionStatuses(clusterId);
  return (statuses.data ?? []).filter((s) => isActive(s.state)).length;
}

function anyActive(statuses: RunStatus[] | undefined): boolean {
  return (statuses ?? []).some((s) => isActive(s.state));
}

export function useActionHistory(actionId: string | null, live: boolean) {
  return useQuery({
    queryKey: actionKeys.history(actionId ?? ""),
    queryFn: () => actionsApi.history(actionId ?? ""),
    enabled: actionId != null,
    refetchInterval: live ? LIVE_INTERVAL : false,
  });
}

export function useExecution(actionId: string, executionId: number | null) {
  return useQuery({
    queryKey: actionKeys.execution(actionId, executionId ?? -1),
    queryFn: () => actionsApi.execution(actionId, executionId ?? -1),
    enabled: executionId != null,
    // A finished execution never changes.
    staleTime: Infinity,
  });
}

/** Whether `runtime` answers at `endpoint`; null skips the check. Read-only, so it runs as the user types. */
export function useEndpointCheck(endpoint: string | null, runtime: LambdaRuntime) {
  return useQuery({
    queryKey: actionKeys.endpoint(endpoint ?? "", runtime),
    queryFn: () => actionsApi.checkEndpoint(endpoint ?? "", runtime),
    enabled: endpoint != null,
    staleTime: 0,
    retry: false,
  });
}

/** The functions in a saved SAM project folder, read again each time the editor opens. */
export function useDiscovery(projectDir: string | null) {
  return useQuery({
    queryKey: actionKeys.discovery(projectDir ?? ""),
    queryFn: () => actionsApi.discover(projectDir ?? ""),
    enabled: projectDir != null,
    retry: false,
  });
}

/** Asks for a project folder (a native picker) and caches what it finds under that folder. */
export function useChooseProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => actionsApi.discover(null),
    onSuccess: (found) => {
      if (found) queryClient.setQueryData(actionKeys.discovery(found.projectDir), found);
    },
  });
}

export function useSaveAction(clusterId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (action: Action) => actionsApi.save(action),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: actionKeys.all(clusterId) }),
  });
}

export function useDeleteAction(clusterId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: actionsApi.remove,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: actionKeys.all(clusterId) }),
  });
}

/** Start and Stop both refresh the statuses, which turns polling on or off. */
export function useStartAction(clusterId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: actionsApi.start,
    onSettled: () => queryClient.invalidateQueries({ queryKey: actionKeys.statuses(clusterId) }),
  });
}

export function useStopAction(clusterId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: actionsApi.stop,
    onSettled: () => queryClient.invalidateQueries({ queryKey: actionKeys.statuses(clusterId) }),
  });
}

export function useClearHistory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: actionsApi.clearHistory,
    onSuccess: (_, actionId) => queryClient.invalidateQueries({ queryKey: actionKeys.history(actionId) }),
  });
}

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { automationsApi } from "./api";
import type { Automation, Body, PreviewSample } from "./types";

// Automations belong to the app, not to one cluster, so they live outside `clusterKeys.scope`.
export const automationKeys = {
  all: ["automations"] as const,
  statuses: ["automations", "statuses"] as const,
};

export function useAutomations() {
  return useQuery({ queryKey: automationKeys.all, queryFn: automationsApi.list, staleTime: Infinity });
}

/** What each automation is doing. Counters change as messages arrive, so this polls. */
export function useAutomationStatuses() {
  return useQuery({
    queryKey: automationKeys.statuses,
    queryFn: automationsApi.statuses,
    refetchInterval: 2000,
  });
}

function useRefreshAutomations() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: automationKeys.all });
}

export function useSaveAutomation() {
  const refresh = useRefreshAutomations();
  return useMutation({ mutationFn: automationsApi.save, onSuccess: refresh });
}

export function useSetAutomationEnabled() {
  const refresh = useRefreshAutomations();
  return useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => automationsApi.setEnabled(id, enabled),
    onSuccess: refresh,
  });
}

export function useDeleteAutomation() {
  const refresh = useRefreshAutomations();
  return useMutation({ mutationFn: automationsApi.remove, onSuccess: refresh });
}

export function useTestAutomation() {
  return useMutation({
    mutationFn: ({ automation, route, sample }: { automation: Automation; route: number; sample: PreviewSample | null }) =>
      automationsApi.test(automation, route, sample),
  });
}

/** The body for a sample message. Keeps the last good preview while the user types. */
export function useBodyPreview(name: string, body: Body, split: string | null, sample: PreviewSample, enabled: boolean) {
  return useQuery({
    queryKey: [...automationKeys.all, "preview", name, body, split, sample] as const,
    queryFn: () => automationsApi.previewBody(name, body, split, sample),
    enabled,
    placeholderData: keepPreviousData,
    retry: false,
  });
}

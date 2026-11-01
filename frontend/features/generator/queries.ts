import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { generatorApi } from "./api";
import type { RecordTemplate } from "./types";

const generatorKeys = {
  list: ["generator", "list"] as const,
  preview: (template: RecordTemplate) => ["generator", "preview", template] as const,
};

/** The placeholder cheat sheet. Fixed for the app's lifetime. */
export function useGenerators() {
  return useQuery({ queryKey: generatorKeys.list, queryFn: generatorApi.list, staleTime: Infinity });
}

/** Sample records for a template. Keeps the last good preview while the user types. */
export function usePreview(template: RecordTemplate) {
  return useQuery({
    queryKey: generatorKeys.preview(template),
    queryFn: () => generatorApi.preview(template, 3),
    placeholderData: keepPreviousData,
    retry: false,
  });
}

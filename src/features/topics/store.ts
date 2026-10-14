import { create } from "zustand";

interface TopicListFilters {
  search: string;
  showInternal: boolean;
  setSearch: (search: string) => void;
  setShowInternal: (showInternal: boolean) => void;
}

/**
 * Topic list filters live outside the page component so they survive
 * opening a topic and coming back.
 */
export const useTopicListFilters = create<TopicListFilters>()((set) => ({
  search: "",
  showInternal: false,
  setSearch: (search) => set({ search }),
  setShowInternal: (showInternal) => set({ showInternal }),
}));

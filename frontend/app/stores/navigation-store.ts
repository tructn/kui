import { create } from "zustand";
import { persist } from "zustand/middleware";

import { settingsStorage } from "@/lib/settings-storage";

/**
 * Every screen in the app. Add a new page by adding a variant here
 * and a case in `app/router.tsx`.
 */
export type Route =
  | { page: "brokers" }
  | { page: "topics" }
  | { page: "topic"; topic: string }
  | { page: "consumer-groups" };

/** The page a cluster opens on: its brokers, first in the sidebar. */
const HOME_ROUTE: Route = { page: "brokers" };

interface NavigationState {
  /** The cluster every page is showing, or null when none is selected. */
  clusterId: string | null;
  route: Route;
  selectCluster: (clusterId: string | null) => void;
  navigate: (route: Route) => void;
}

/**
 * Which cluster and page are showing. A desktop app has no URL bar,
 * so a tiny store replaces a router library.
 *
 * Read with a selector so components only re-render when their slice changes:
 *   const navigate = useNavigation((s) => s.navigate);
 */
export const useNavigation = create<NavigationState>()(
  persist(
    (set) => ({
      clusterId: null,
      route: HOME_ROUTE,
      selectCluster: (clusterId) => set({ clusterId, route: HOME_ROUTE }),
      navigate: (route) => set({ route }),
    }),
    {
      name: "kui.navigation",
      storage: settingsStorage(),
      // Remember the last cluster across restarts, but always open on the home page.
      partialize: (state) => ({ clusterId: state.clusterId }),
    },
  ),
);

/** For pages that only render once a cluster is selected (see `app/app-shell.tsx`). */
export function useClusterId(): string {
  const clusterId = useNavigation((s) => s.clusterId);
  if (!clusterId) throw new Error("No cluster selected");
  return clusterId;
}

// Mirrors `src-tauri/src/features/clusters/commands.rs`.
import { callCommand } from "@/lib/invoke";

import type { ClusterConfig } from "./types";

export const clustersApi = {
  list: () => callCommand<ClusterConfig[]>("list_clusters"),
  save: (cluster: ClusterConfig) => callCommand<ClusterConfig>("save_cluster", { cluster }),
  remove: (clusterId: string) => callCommand<void>("delete_cluster", { clusterId }),
  /** Resolves to the number of brokers reachable. */
  testConnection: (cluster: ClusterConfig) => callCommand<number>("test_connection", { cluster }),
};

// Mirrors `src-tauri/src/features/brokers/commands.rs`.
import { callCommand } from "@/lib/invoke";

import type { ClusterOverview } from "./types";

export const brokersApi = {
  overview: (clusterId: string) => callCommand<ClusterOverview>("cluster_overview", { clusterId }),
};

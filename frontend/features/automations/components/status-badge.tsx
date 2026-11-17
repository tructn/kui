import { Badge } from "@/components/ui/badge";

import type { AutomationStatus } from "../types";

/** Off, waiting for messages, or failing to read the topic and trying again. */
export function StatusBadge({ enabled, status }: { enabled: boolean; status: AutomationStatus | undefined }) {
  if (!enabled) return <Badge variant="outline">Off</Badge>;
  switch (status?.state) {
    case "running":
      return <Badge variant="secondary">Watching</Badge>;
    case "retrying":
      return <Badge variant="destructive">Retrying</Badge>;
    case "stopped":
    case undefined:
      return <Badge variant="outline">Starting</Badge>;
  }
}

import { ReloadIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/components/ui/button";

import { useRefreshActions } from "../queries";

export function RefreshActionsButton({ clusterId }: { clusterId: string }) {
  const refresh = useRefreshActions(clusterId);
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Refresh"
      title="Refresh"
      disabled={refresh.isPending}
      onClick={() => refresh.mutate()}
    >
      <HugeiconsIcon icon={ReloadIcon} className={refresh.isPending ? "animate-spin" : undefined} />
    </Button>
  );
}

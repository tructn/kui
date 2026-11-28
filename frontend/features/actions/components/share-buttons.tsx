import { FileExportIcon, FileImportIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import { useExportActions, useImportActions } from "../queries";

/** Adds the Actions from a file a teammate shared; they're checked in Rust before any is saved. */
export function ImportActionsButton({ clusterId, variant = "outline" }: { clusterId: string; variant?: "outline" | "default" }) {
  const importing = useImportActions(clusterId);
  return (
    <Button
      size="sm"
      variant={variant}
      disabled={importing.isPending}
      onClick={() =>
        importing.mutate(undefined, {
          onSuccess: (imported) => {
            if (!imported) return;
            const names = imported.map((a) => a.name).join(", ");
            toast.success(`Imported ${imported.length} action${imported.length === 1 ? "" : "s"}`, { description: names });
          },
          onError: (e) => toast.error("Couldn't import", { description: e.message }),
        })
      }
    >
      <HugeiconsIcon icon={FileImportIcon} /> Import
    </Button>
  );
}

interface ExportActionsButtonProps {
  clusterId: string;
  actionIds: string[];
  label?: string;
}

/** Saves the Actions to a file teammates can import. It leaves out this machine's cluster and ids. */
export function ExportActionsButton({ clusterId, actionIds, label = "Export" }: ExportActionsButtonProps) {
  const exporting = useExportActions(clusterId);
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={exporting.isPending || actionIds.length === 0}
      onClick={() =>
        exporting.mutate(actionIds, {
          onSuccess: (path) => path && toast.success("Exported actions", { description: path }),
          onError: (e) => toast.error("Couldn't export", { description: e.message }),
        })
      }
    >
      <HugeiconsIcon icon={FileExportIcon} /> {label}
    </Button>
  );
}

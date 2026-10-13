import {
  CheckIcon,
  ChevronsUpDownIcon,
  DatabaseIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { useNavigation } from "@/app/stores/navigation-store";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

import { useClusters, useDeleteCluster } from "../queries";
import type { ClusterConfig } from "../types";
import { ClusterFormDialog } from "./cluster-form-dialog";

type DialogState =
  | { kind: "closed" }
  | { kind: "add" }
  | { kind: "edit" | "delete"; cluster: ClusterConfig };

/** Sidebar header dropdown for picking, adding, editing and deleting clusters. */
export function ClusterSwitcher() {
  const clusterId = useNavigation((s) => s.clusterId);
  const selectCluster = useNavigation((s) => s.selectCluster);
  const { data: clusters = [] } = useClusters();
  const deleteCluster = useDeleteCluster();
  const [dialog, setDialog] = useState<DialogState>({ kind: "closed" });
  const close = () => setDialog({ kind: "closed" });

  const active = clusters.find((c) => c.id === clusterId);

  function confirmDelete(cluster: ClusterConfig) {
    deleteCluster.mutate(cluster.id, {
      onSuccess: () => {
        toast.success(`Removed ${cluster.name}`);
        if (cluster.id === clusterId) selectCluster(null);
      },
      onError: (e) => toast.error(e.message),
    });
  }

  return (
    <>
      <SidebarMenu>
        <SidebarMenuItem>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <SidebarMenuButton size="lg">
                <img src="/logo.svg" alt="" className="size-8 shrink-0" />
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">
                    {active?.name ?? "KUI"}
                  </span>
                  <span className="truncate font-mono text-xs text-muted-foreground">
                    {active?.bootstrapServers ?? "No cluster selected"}
                  </span>
                </div>
                <ChevronsUpDownIcon className="ml-auto" />
              </SidebarMenuButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              className="min-w-64"
              align="start"
              side="bottom"
            >
              <DropdownMenuLabel>Clusters</DropdownMenuLabel>
              {clusters.map((c) => (
                <DropdownMenuItem
                  key={c.id}
                  onSelect={() => selectCluster(c.id)}
                >
                  <DatabaseIcon />
                  <span className="flex-1 truncate">{c.name}</span>
                  {c.id === clusterId && <CheckIcon />}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setDialog({ kind: "add" })}>
                <PlusIcon /> Add cluster
              </DropdownMenuItem>
              {active && (
                <>
                  <DropdownMenuItem
                    onSelect={() =>
                      setDialog({ kind: "edit", cluster: active })
                    }
                  >
                    <PencilIcon /> Edit {active.name}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() =>
                      setDialog({ kind: "delete", cluster: active })
                    }
                  >
                    <Trash2Icon /> Remove {active.name}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>

      <ClusterFormDialog
        open={dialog.kind === "add" || dialog.kind === "edit"}
        onOpenChange={(open) => !open && close()}
        cluster={dialog.kind === "edit" ? dialog.cluster : undefined}
        onSaved={(saved) => selectCluster(saved.id)}
      />

      <AlertDialog
        open={dialog.kind === "delete"}
        onOpenChange={(open) => !open && close()}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove {dialog.kind === "delete" && dialog.cluster.name}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This only removes the saved connection from KUI. Nothing on the
              Kafka cluster is changed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() =>
                dialog.kind === "delete" && confirmDelete(dialog.cluster)
              }
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

import { toast } from "sonner";

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

import { useDeleteAction } from "../queries";
import type { Action } from "../types";

interface DeleteActionDialogProps {
  clusterId: string;
  action: Action;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
}

export function DeleteActionDialog({ clusterId, action, open, onOpenChange, onDeleted }: DeleteActionDialogProps) {
  const remove = useDeleteAction(clusterId);
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {action.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            The action and its history go away. Its consumer group <span className="font-mono">{action.source.groupId}</span>{" "}
            stays on the cluster with its committed offsets.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() =>
              remove.mutate(action.id, {
                onSuccess: () => {
                  toast.success(`Deleted ${action.name}`);
                  onDeleted();
                },
                onError: (e) => toast.error("Couldn't delete", { description: e.message }),
              })
            }
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

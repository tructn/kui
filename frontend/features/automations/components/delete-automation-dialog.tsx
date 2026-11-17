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

import { useDeleteAutomation } from "../queries";
import type { Automation } from "../types";

interface DeleteAutomationDialogProps {
  /** The automation to delete; null keeps the dialog closed. */
  automation: Automation | null;
  onClose: () => void;
}

export function DeleteAutomationDialog({ automation, onClose }: DeleteAutomationDialogProps) {
  const remove = useDeleteAutomation();

  function handleDelete() {
    if (!automation) return;
    remove.mutate(automation.id, {
      onSuccess: () => {
        toast.success(`Deleted ${automation.name}`);
        onClose();
      },
      onError: (e) => toast.error(e.message),
    });
  }

  return (
    <AlertDialog open={automation !== null} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {automation?.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            It stops running, and its webhook URL and headers are removed from this machine.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={remove.isPending} onClick={handleDelete}>
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

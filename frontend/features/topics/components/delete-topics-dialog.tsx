import { useState } from "react";
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
import { Input } from "@/components/ui/input";

import { useDeleteTopics } from "../queries";

interface DeleteTopicsDialogProps {
  clusterId: string;
  topics: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the topics that could not be deleted (empty when all succeeded). */
  onDone: (failed: string[]) => void;
}

/** Deletes several topics after typing "delete N topics", reporting each failure. */
export function DeleteTopicsDialog({ clusterId, topics, open, onOpenChange, onDone }: DeleteTopicsDialogProps) {
  const [confirmation, setConfirmation] = useState("");
  const deleteTopics = useDeleteTopics(clusterId);
  const phrase = `delete ${topics.length} ${topics.length === 1 ? "topic" : "topics"}`;

  function handleOpenChange(next: boolean) {
    setConfirmation("");
    onOpenChange(next);
  }

  function handleDelete() {
    deleteTopics.mutate(topics, {
      onSuccess: (results) => {
        const failed = results.filter((r) => r.error);
        const deleted = results.length - failed.length;
        if (deleted > 0) toast.success(`Deleted ${deleted} ${deleted === 1 ? "topic" : "topics"}`);
        if (failed.length > 0) {
          toast.error(`${failed.length} could not be deleted`, {
            description: failed.map((r) => `${r.topic}: ${r.error}`).join("; "),
          });
        }
        onDone(failed.map((r) => r.topic));
      },
      onError: (e) => toast.error(e.message),
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Delete {topics.length} {topics.length === 1 ? "topic" : "topics"}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            All messages in these topics are deleted permanently. Type{" "}
            <span className="font-mono text-foreground">{phrase}</span> to confirm.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ul className="max-h-40 overflow-auto rounded-md border p-2 font-mono text-xs">
          {topics.map((t) => (
            <li key={t} className="truncate py-0.5">
              {t}
            </li>
          ))}
        </ul>
        <Input
          className="font-mono"
          aria-label="Confirmation"
          placeholder={phrase}
          value={confirmation}
          onChange={(e) => setConfirmation(e.target.value)}
        />
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={confirmation.trim() !== phrase || deleteTopics.isPending}
            onClick={handleDelete}
          >
            Delete {topics.length}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

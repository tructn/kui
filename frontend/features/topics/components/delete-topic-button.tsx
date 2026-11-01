import { Trash2Icon } from "lucide-react";
import { useState, type ReactNode } from "react";
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { useDeleteTopic } from "../queries";

interface DeleteTopicButtonProps {
  clusterId: string;
  topic: string;
  onDeleted?: () => void;
  /** Replaces the default "Delete" button, e.g. with an icon in a table row. */
  trigger?: ReactNode;
}

/** Delete with a type-the-name confirmation, since deleting a topic loses its data. */
export function DeleteTopicButton({ clusterId, topic, onDeleted, trigger }: DeleteTopicButtonProps) {
  const [confirmation, setConfirmation] = useState("");
  const deleteTopic = useDeleteTopic(clusterId);

  function handleDelete() {
    deleteTopic.mutate(topic, {
      onSuccess: () => {
        toast.success(`Deleted ${topic}`);
        onDeleted?.();
      },
      onError: (e) => toast.error(e.message),
    });
  }

  return (
    <AlertDialog onOpenChange={() => setConfirmation("")}>
      <AlertDialogTrigger asChild>
        {trigger ?? (
          <Button variant="destructive" size="sm">
            <Trash2Icon /> Delete
          </Button>
        )}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete topic?</AlertDialogTitle>
          <AlertDialogDescription>
            All messages in <span className="font-mono text-foreground">{topic}</span> are deleted permanently. Type
            the topic name to confirm.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Input
          className="font-mono"
          aria-label="Topic name"
          value={confirmation}
          onChange={(e) => setConfirmation(e.target.value)}
        />
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={confirmation !== topic} onClick={handleDelete}>
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

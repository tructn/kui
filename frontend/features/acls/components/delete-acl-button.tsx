import { Trash2Icon } from "lucide-react";
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

import { describeAcl } from "../acl";
import { useDeleteAcls } from "../queries";
import type { AclBinding } from "../types";

interface DeleteAclButtonProps {
  clusterId: string;
  acl: AclBinding;
}

/** Deletes exactly one ACL after a confirmation, since removing an Allow can cut off a running client. */
export function DeleteAclButton({ clusterId, acl }: DeleteAclButtonProps) {
  const deleteAcls = useDeleteAcls(clusterId);
  const description = describeAcl(acl);

  function handleDelete() {
    deleteAcls.mutate([acl], {
      onSuccess: () => toast.success("Deleted ACL"),
      onError: (e) => toast.error(e.message),
    });
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Delete ACL: ${description}`}>
          <Trash2Icon />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete ACL?</AlertDialogTitle>
          <AlertDialogDescription>
            Clients relying on this ACL lose that access immediately:
            <span className="mt-2 block font-mono text-foreground">{description}</span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={handleDelete}>
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

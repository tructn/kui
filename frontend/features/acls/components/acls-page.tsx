import { RotateCwIcon, SearchIcon, ShieldOffIcon, Trash2Icon } from "lucide-react";
import { useMemo } from "react";
import { toast } from "sonner";

import { useClusterId } from "@/app/stores/navigation-store";
import { PageHeader } from "@/components/page-header";
import { emptyText, ErrorState } from "@/components/query-states";
import { SortableTableHead } from "@/components/sortable-table-head";
import { TableFrame } from "@/components/table-frame";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableStateRow } from "@/components/ui/table";
import { useColumnResize } from "@/hooks/use-column-resize";
import { usePagination } from "@/hooks/use-pagination";
import { useSort, type SortColumns } from "@/hooks/use-sort";
import { useViewSearch } from "@/hooks/use-view-state";

import { useAcls, useDeleteAcl } from "../queries";
import { aclKey, isAclsDisabled, label, type Acl } from "../types";
import { CreateAclDialog } from "./create-acl-dialog";

const COLUMNS: SortColumns<Acl, "principal" | "permission" | "operation" | "resource" | "host"> = {
  principal: (a) => a.principal,
  permission: (a) => a.permission,
  operation: (a) => a.operation,
  resource: (a) => `${a.resourceType}:${a.resourceName}`,
  host: (a) => a.host,
};

export function AclsPage() {
  const clusterId = useClusterId();
  const acls = useAcls(clusterId);
  const [searchInput, search, setSearchInput] = useViewSearch("acls.search");
  const disabled = isAclsDisabled(acls.error);

  const visible = useMemo(() => {
    const needle = search.toLowerCase();
    return (acls.data ?? []).filter(
      (a) => a.principal.toLowerCase().includes(needle) || a.resourceName.toLowerCase().includes(needle)
    );
  }, [acls.data, search]);
  const sorter = useSort("acls", visible, COLUMNS);
  const pager = usePagination(sorter.rows, `${search}|${sorter.key}`);
  const resize = useColumnResize("acls", 6);

  return (
    <>
      <PageHeader
        title="ACLs"
        description={acls.data ? `${acls.data.length} ACLs` : undefined}
        actions={
          <>
            <Button variant="ghost" size="icon-sm" aria-label="Refresh" onClick={() => acls.refetch()}>
              <RotateCwIcon className={acls.isFetching ? "animate-spin" : undefined} />
            </Button>
            {!disabled && <CreateAclDialog clusterId={clusterId} />}
          </>
        }
      />
      {disabled ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ShieldOffIcon />
            </EmptyMedia>
            <EmptyTitle>ACLs are turned off on this cluster</EmptyTitle>
            <EmptyDescription>
              Its brokers have no authorizer, so every client can do everything. To use ACLs, set{" "}
              <code>authorizer.class.name</code> on the brokers.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-4 p-4">
          <div className="relative max-w-sm">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Filter by principal or resource"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </div>

          {acls.error && <ErrorState error={acls.error} onRetry={() => acls.refetch()} />}
          <TableFrame pager={pager}>
            <Table resize={resize} aria-label="ACLs">
              <TableHeader>
                <TableRow>
                  <SortableTableHead column="principal" sort={sorter.sort} onSort={sorter.toggle}>
                    Principal
                  </SortableTableHead>
                  <SortableTableHead column="permission" sort={sorter.sort} onSort={sorter.toggle} className="w-28">
                    Permission
                  </SortableTableHead>
                  <SortableTableHead column="operation" sort={sorter.sort} onSort={sorter.toggle} className="w-40">
                    Operation
                  </SortableTableHead>
                  <SortableTableHead column="resource" sort={sorter.sort} onSort={sorter.toggle}>
                    Resource
                  </SortableTableHead>
                  <SortableTableHead column="host" sort={sorter.sort} onSort={sorter.toggle} className="w-36">
                    Host
                  </SortableTableHead>
                  <TableHead className="w-12">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pager.items.map((a) => (
                  <TableRow key={aclKey(a)}>
                    <TableCell className="font-mono">{a.principal}</TableCell>
                    <TableCell>
                      <Badge variant={a.permission === "Deny" ? "destructive" : "secondary"}>{label(a.permission)}</Badge>
                    </TableCell>
                    <TableCell>{label(a.operation)}</TableCell>
                    <TableCell>
                      <ResourceCell acl={a} />
                    </TableCell>
                    <TableCell className="font-mono text-muted-foreground">{a.host}</TableCell>
                    <TableCell>
                      <DeleteAclButton clusterId={clusterId} acl={a} />
                    </TableCell>
                  </TableRow>
                ))}
                {visible.length === 0 && (
                  <TableStateRow colSpan={6}>{emptyText(acls, "No ACLs found.")}</TableStateRow>
                )}
              </TableBody>
            </Table>
          </TableFrame>
        </div>
      )}
    </>
  );
}

function ResourceCell({ acl }: { acl: Acl }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Badge variant="outline">{label(acl.resourceType)}</Badge>
      <span className="truncate font-mono" title={acl.resourceName}>
        {acl.resourceName}
      </span>
      {acl.patternType === "Prefixed" && (
        <Badge variant="secondary" title="Matches every name that starts with this text">
          prefix
        </Badge>
      )}
    </div>
  );
}

function DeleteAclButton({ clusterId, acl }: { clusterId: string; acl: Acl }) {
  const deleteAcl = useDeleteAcl(clusterId);

  function handleDelete() {
    deleteAcl.mutate(acl, {
      onSuccess: () => toast.success(`Deleted ACL for ${acl.principal}`),
      onError: (e) => toast.error(e.message),
    });
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Delete ACL for ${acl.principal}`}
          className="text-muted-foreground hover:text-destructive"
          disabled={deleteAcl.isPending}
        >
          <Trash2Icon />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete ACL?</AlertDialogTitle>
          <AlertDialogDescription>
            <span className="font-mono text-foreground">{acl.principal}</span> will no longer be{" "}
            {acl.permission === "Deny" ? "denied" : "allowed"} {label(acl.operation)} on{" "}
            {label(acl.resourceType).toLowerCase()}{" "}
            <span className="font-mono text-foreground">{acl.resourceName}</span>
            {acl.patternType === "Prefixed" && " (prefix)"}
            {acl.permission === "Allow" && ", which can break clients that rely on it"}.
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

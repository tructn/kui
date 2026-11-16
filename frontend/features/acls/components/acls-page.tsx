import { RotateCwIcon, SearchIcon } from "lucide-react";
import { useMemo } from "react";

import { useClusterId } from "@/app/stores/navigation-store";
import { PageHeader } from "@/components/page-header";
import { emptyText, ErrorState } from "@/components/query-states";
import { SortableTableHead } from "@/components/sortable-table-head";
import { TableFrame } from "@/components/table-frame";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableStateRow } from "@/components/ui/table";
import { useColumnResize } from "@/hooks/use-column-resize";
import { usePagination } from "@/hooks/use-pagination";
import { useSort, type SortColumns } from "@/hooks/use-sort";
import { useViewSearch, useViewState } from "@/hooks/use-view-state";

import { aclKey, matchesAcl, OPERATION_LABELS, RESOURCE_LABELS } from "../acl";
import { useAcls } from "../queries";
import type { AclBinding, ResourceType } from "../types";
import { CreateAclDialog } from "./create-acl-dialog";
import { DeleteAclButton } from "./delete-acl-button";

const ANY_RESOURCE = "any";
const RESOURCE_TYPES = Object.keys(RESOURCE_LABELS) as ResourceType[];

const COLUMNS: SortColumns<AclBinding, "principal" | "permission" | "operation" | "resource" | "host"> = {
  principal: (a) => a.principal,
  permission: (a) => a.permission,
  operation: (a) => OPERATION_LABELS[a.operation],
  resource: (a) => `${RESOURCE_LABELS[a.resourceType]} ${a.resourceName}`,
  host: (a) => a.host,
};

export function AclsPage() {
  const clusterId = useClusterId();
  const acls = useAcls(clusterId);
  const [searchInput, search, setSearchInput] = useViewSearch("acls.search");
  const [resource, setResource] = useViewState<ResourceType | typeof ANY_RESOURCE>("acls.resource", ANY_RESOURCE);

  const visible = useMemo(
    () =>
      (acls.data ?? []).filter(
        (a) => (resource === ANY_RESOURCE || a.resourceType === resource) && matchesAcl(a, search),
      ),
    [acls.data, resource, search],
  );
  const sorter = useSort("acls", visible, COLUMNS);
  const pager = usePagination(sorter.rows, `${search}|${resource}|${sorter.key}`);
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
            <CreateAclDialog clusterId={clusterId} />
          </>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col gap-4 p-4">
        <div className="flex flex-wrap gap-2">
          <div className="relative w-full max-w-sm">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Filter by principal, resource or host"
              aria-label="Filter ACLs"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </div>
          <Select value={resource} onValueChange={(v) => setResource(v as ResourceType | typeof ANY_RESOURCE)}>
            <SelectTrigger className="w-44" aria-label="Resource type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY_RESOURCE}>All resources</SelectItem>
              {RESOURCE_TYPES.map((r) => (
                <SelectItem key={r} value={r}>
                  {RESOURCE_LABELS[r]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
                <SortableTableHead column="host" sort={sorter.sort} onSort={sorter.toggle} className="w-32">
                  Host
                </SortableTableHead>
                <TableHead className="w-12">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pager.items.map((acl) => (
                <TableRow key={aclKey(acl)}>
                  <TableCell className="font-mono">{acl.principal}</TableCell>
                  <TableCell>
                    <Badge variant={acl.permission === "deny" ? "destructive" : "secondary"}>
                      {acl.permission === "deny" ? "Deny" : "Allow"}
                    </Badge>
                  </TableCell>
                  <TableCell>{OPERATION_LABELS[acl.operation]}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{RESOURCE_LABELS[acl.resourceType]}</Badge>
                      <span className="truncate font-mono">{acl.resourceName}</span>
                      {acl.patternType === "prefixed" && <Badge variant="secondary">prefix</Badge>}
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-muted-foreground">{acl.host}</TableCell>
                  <TableCell>
                    <DeleteAclButton clusterId={clusterId} acl={acl} />
                  </TableCell>
                </TableRow>
              ))}
              {visible.length === 0 && <TableStateRow colSpan={6}>{emptyText(acls, "No ACLs found.")}</TableStateRow>}
            </TableBody>
          </Table>
        </TableFrame>
      </div>
    </>
  );
}

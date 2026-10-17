import { ArrowUpRightIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";

import { useNavigation } from "@/app/stores/navigation-store";
import { ErrorState, LoadingRows } from "@/components/query-states";
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
import { ResizableSheetContent } from "@/components/resizable-sheet-content";
import { SortableTableHead } from "@/components/sortable-table-head";
import { Sheet, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { TableFrame } from "@/components/table-frame";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { useColumnResize } from "@/hooks/use-column-resize";
import { usePagination } from "@/hooks/use-pagination";
import { useSort, type SortColumns } from "@/hooks/use-sort";
import { formatNumber } from "@/lib/format";

import { useConsumerGroup, useDeleteConsumerGroup } from "../queries";
import type { GroupDetail, GroupMember } from "../types";
import { GroupStateBadge } from "./group-state-badge";
import { ProgressLegend } from "./progress-bar";
import { ProgressSection } from "./progress-section";

interface GroupDetailSheetProps {
  clusterId: string;
  /** Group to show; null closes the sheet. */
  group: string | null;
  onClose: () => void;
}

const MEMBER_COLUMNS: SortColumns<GroupMember, "clientId" | "host" | "assignment"> = {
  clientId: (m) => m.clientId,
  host: (m) => m.host,
  // By how many partitions the member holds.
  assignment: (m) => Object.values(m.assignment).reduce((n, partitions) => n + partitions.length, 0),
};

export function GroupDetailSheet({ clusterId, group, onClose }: GroupDetailSheetProps) {
  const detail = useConsumerGroup(clusterId, group);

  return (
    <Sheet open={group != null} onOpenChange={(open) => !open && onClose()}>
      <ResizableSheetContent panelId="consumer-group" defaultWidth={768}>
        <SheetHeader className="border-b">
          <SheetTitle className="font-mono">{group}</SheetTitle>
          <SheetDescription>How far the group has read each topic and partition</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-6 overflow-auto p-4">
          {detail.error && <ErrorState error={detail.error} onRetry={() => detail.refetch()} />}
          {detail.isPending && <LoadingRows />}
          {detail.data && <GroupDetailBody clusterId={clusterId} detail={detail.data} onDeleted={onClose} />}
        </div>
      </ResizableSheetContent>
    </Sheet>
  );
}

function GroupDetailBody({
  clusterId,
  detail,
  onDeleted,
}: {
  clusterId: string;
  detail: GroupDetail;
  onDeleted: () => void;
}) {
  const deleteGroup = useDeleteConsumerGroup(clusterId);
  const navigate = useNavigation((s) => s.navigate);
  const memberSort = useSort("group-members", detail.members, MEMBER_COLUMNS);
  const members = usePagination(memberSort.rows, memberSort.key);
  const memberResize = useColumnResize("group-members", 3);

  function handleDelete() {
    deleteGroup.mutate(detail.name, {
      onSuccess: () => {
        toast.success(`Deleted ${detail.name}`);
        onDeleted();
      },
      onError: (e) => toast.error(e.message),
    });
  }

  return (
    <>
      <div className="flex items-center gap-3">
        <GroupStateBadge state={detail.state} />
        <span className="text-sm text-muted-foreground">
          Total lag <span className="font-mono text-foreground tabular-nums">{formatNumber(detail.totalLag)}</span>
        </span>
        <div className="flex-1" />
        <AlertDialog>
          <AlertDialogTrigger asChild>
            {/* Kafka only allows deleting groups without active members. */}
            <Button variant="destructive" size="sm" disabled={detail.members.length > 0}>
              <Trash2Icon /> Delete group
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {detail.name}?</AlertDialogTitle>
              <AlertDialogDescription>
                Its committed offsets are removed permanently. Consumers rejoining will start from their
                auto.offset.reset position.
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
      </div>

      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-medium">Topics ({detail.topics.length})</h3>
          <ProgressLegend />
        </div>
        {detail.topics.length === 0 && <p className="text-sm text-muted-foreground">No committed offsets.</p>}
        {detail.topics.map((t) => (
          <ProgressSection
            key={t.topic}
            title={t.topic}
            progress={t}
            offsets={detail.offsets.filter((o) => o.topic === t.topic)}
            defaultOpen={detail.topics.length === 1}
            extra={
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Open ${t.topic}`}
                onClick={() => navigate({ page: "topic", topic: t.topic })}
              >
                <ArrowUpRightIcon />
              </Button>
            }
          />
        ))}
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Members ({detail.members.length})</h3>
        {detail.members.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active members.</p>
        ) : (
          <TableFrame pager={members} fill={false}>
            <Table resize={memberResize}>
              <TableHeader>
                <TableRow>
                  <SortableTableHead column="clientId" sort={memberSort.sort} onSort={memberSort.toggle}>
                    Client ID
                  </SortableTableHead>
                  <SortableTableHead column="host" sort={memberSort.sort} onSort={memberSort.toggle}>
                    Host
                  </SortableTableHead>
                  <SortableTableHead column="assignment" sort={memberSort.sort} onSort={memberSort.toggle}>
                    Assignment
                  </SortableTableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.items.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="font-mono text-xs">{m.clientId}</TableCell>
                    <TableCell className="font-mono text-xs">{m.host}</TableCell>
                    <TableCell className="flex flex-wrap gap-1">
                      {Object.entries(m.assignment).map(([topic, partitions]) => (
                        <Badge key={topic} variant="outline" className="font-mono">
                          {topic} [{partitions.join(", ")}]
                        </Badge>
                      ))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableFrame>
        )}
      </section>
    </>
  );
}

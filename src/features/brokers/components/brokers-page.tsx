import { RotateCwIcon } from "lucide-react";

import { useClusterId } from "@/app/stores/navigation-store";
import { PageHeader } from "@/components/page-header";
import { emptyText, ErrorState } from "@/components/query-states";
import { SortableTableHead } from "@/components/sortable-table-head";
import { StatCard } from "@/components/stat-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { TableFrame } from "@/components/table-frame";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { useColumnResize } from "@/hooks/use-column-resize";
import { usePagination } from "@/hooks/use-pagination";
import { useSort, type SortColumns } from "@/hooks/use-sort";
import { formatNumber } from "@/lib/format";

import { useClusterOverview } from "../queries";
import type { Broker } from "../types";

const NO_BROKERS: Broker[] = [];

const COLUMNS: SortColumns<Broker, "id" | "host" | "port" | "leaders" | "replicas"> = {
  id: (b) => b.id,
  host: (b) => b.host,
  port: (b) => b.port,
  leaders: (b) => b.leaderPartitions,
  replicas: (b) => b.replicaPartitions,
};

export function BrokersPage() {
  const clusterId = useClusterId();
  const overview = useClusterOverview(clusterId);
  const data = overview.data;
  const sorter = useSort("brokers", data?.brokers ?? NO_BROKERS, COLUMNS);
  const pager = usePagination(sorter.rows, sorter.key);
  const resize = useColumnResize("brokers", 5);
  // Stat value until the overview arrives: pulsing while it loads, a dash if it failed.
  const placeholder = overview.isPending ? <Skeleton className="h-8 w-12" /> : "—";

  return (
    <>
      <PageHeader
        title="Brokers"
        description="Cluster health and partition distribution"
        actions={
          <Button variant="ghost" size="icon-sm" aria-label="Refresh" onClick={() => overview.refetch()}>
            <RotateCwIcon className={overview.isFetching ? "animate-spin" : undefined} />
          </Button>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col gap-4 p-4">
        {overview.error && <ErrorState error={overview.error} onRetry={() => overview.refetch()} />}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          <StatCard label="Brokers" value={data ? data.brokers.length : placeholder} />
          <StatCard label="Topics" value={data ? formatNumber(data.topicCount) : placeholder} />
          <StatCard label="Partitions" value={data ? formatNumber(data.partitionCount) : placeholder} />
          <StatCard
            label="Under-replicated"
            value={data ? data.underReplicatedPartitions : placeholder}
            warning={(data?.underReplicatedPartitions ?? 0) > 0}
          />
          <StatCard
            label="Offline"
            value={data ? data.offlinePartitions : placeholder}
            warning={(data?.offlinePartitions ?? 0) > 0}
          />
        </div>

        <TableFrame pager={pager}>
          <Table resize={resize}>
            <TableHeader>
              <TableRow>
                <SortableTableHead column="id" sort={sorter.sort} onSort={sorter.toggle} className="w-20">ID</SortableTableHead>
                <SortableTableHead column="host" sort={sorter.sort} onSort={sorter.toggle}>Host</SortableTableHead>
                <SortableTableHead column="port" sort={sorter.sort} onSort={sorter.toggle} className="w-24">Port</SortableTableHead>
                <SortableTableHead column="leaders" sort={sorter.sort} onSort={sorter.toggle} align="right" className="w-40">Leader partitions</SortableTableHead>
                <SortableTableHead column="replicas" sort={sorter.sort} onSort={sorter.toggle} align="right" className="w-40">Replicas</SortableTableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="font-mono tabular-nums">
              {pager.items.map((b) => (
                <TableRow key={b.id}>
                  <TableCell>{b.id}</TableCell>
                  <TableCell>{b.host}</TableCell>
                  <TableCell>{b.port}</TableCell>
                  <TableCell className="text-right">{formatNumber(b.leaderPartitions)}</TableCell>
                  <TableCell className="text-right">{formatNumber(b.replicaPartitions)}</TableCell>
                </TableRow>
              ))}
              {sorter.rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center font-sans text-muted-foreground">
                    {emptyText(overview, "No brokers found.")}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableFrame>
      </div>
    </>
  );
}

import { SortableTableHead } from "@/components/sortable-table-head";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { TableFrame } from "@/components/table-frame";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { useColumnResize } from "@/hooks/use-column-resize";
import { usePagination } from "@/hooks/use-pagination";
import { useSort, type SortColumns } from "@/hooks/use-sort";
import { useViewState } from "@/hooks/use-view-state";

import type { TopicConfigEntry } from "../types";

const COLUMNS: SortColumns<TopicConfigEntry, "name" | "value" | "source"> = {
  name: (c) => c.name,
  value: (c) => (c.isSensitive ? null : c.value), // hidden values sort last
  source: (c) => c.source,
};

export function ConfigsTable({ configs }: { configs: TopicConfigEntry[] }) {
  const [overridesOnly, setOverridesOnly] = useViewState("topic-configs.overridesOnly", false);
  const visible = overridesOnly ? configs.filter((c) => !c.isDefault) : configs;
  const sorter = useSort("topic-configs", visible, COLUMNS);
  const pager = usePagination(sorter.rows, `${overridesOnly}|${sorter.key}`);
  const resize = useColumnResize("topic-configs", 3);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex items-center gap-2">
        <Switch id="overrides-only" checked={overridesOnly} onCheckedChange={setOverridesOnly} />
        <Label htmlFor="overrides-only">Only show overridden values</Label>
      </div>
      <TableFrame pager={pager}>
        <Table resize={resize}>
          <TableHeader>
            <TableRow>
              <SortableTableHead column="name" sort={sorter.sort} onSort={sorter.toggle}>Name</SortableTableHead>
              <SortableTableHead column="value" sort={sorter.sort} onSort={sorter.toggle}>Value</SortableTableHead>
              <SortableTableHead column="source" sort={sorter.sort} onSort={sorter.toggle} className="w-48">Source</SortableTableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pager.items.map((c) => (
              <TableRow key={c.name}>
                <TableCell className="font-mono text-xs">{c.name}</TableCell>
                <TableCell className="font-mono text-xs break-all whitespace-normal">
                  {c.isSensitive ? "••••••" : c.value ?? <span className="text-muted-foreground">null</span>}
                </TableCell>
                <TableCell>
                  <Badge variant={c.isDefault ? "outline" : "secondary"}>{c.source}</Badge>
                </TableCell>
              </TableRow>
            ))}
            {visible.length === 0 && (
              <TableRow>
                <TableCell colSpan={3} className="h-24 text-center text-muted-foreground">
                  No overridden values.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableFrame>
    </div>
  );
}

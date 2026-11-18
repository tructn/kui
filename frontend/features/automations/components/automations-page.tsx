import {
  EllipsisIcon,
  FileDownIcon,
  FileUpIcon,
  HistoryIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  UploadCloudIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { useClusterId } from "@/app/stores/navigation-store";
import { PageHeader } from "@/components/page-header";
import { emptyText, ErrorState } from "@/components/query-states";
import { TableFrame } from "@/components/table-frame";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableStateRow } from "@/components/ui/table";
import { formatNumber } from "@/lib/format";

import { automationsApi } from "../api";
import { useAutomations, useAutomationStatuses, useSetAutomationEnabled } from "../queries";
import { emptyAutomation, type Automation } from "../types";
import { AutomationFormDialog } from "./automation-form-dialog";
import { DeleteAutomationDialog } from "./delete-automation-dialog";
import { KafkaConnectDialog } from "./kafka-connect-dialog";
import { ReplayDialog } from "./replay-dialog";
import { StatusBadge } from "./status-badge";

export function AutomationsPage() {
  const clusterId = useClusterId();
  const automations = useAutomations();
  const statuses = useAutomationStatuses();
  const setEnabled = useSetAutomationEnabled();
  const [editing, setEditing] = useState<Automation | null>(null);
  const [deleting, setDeleting] = useState<Automation | null>(null);
  const [replaying, setReplaying] = useState<Automation | null>(null);
  const [publishing, setPublishing] = useState<Automation | null>(null);

  const statusById = useMemo(() => new Map((statuses.data ?? []).map((s) => [s.id, s])), [statuses.data]);
  const visible = useMemo(
    () => (automations.data ?? []).filter((a) => a.clusterId === clusterId),
    [automations.data, clusterId]
  );

  function toggle(automation: Automation, enabled: boolean) {
    setEnabled.mutate(
      { id: automation.id, enabled },
      { onError: (e) => toast.error(`Could not ${enabled ? "start" : "stop"} ${automation.name}`, { description: e.message }) }
    );
  }

  async function importFile() {
    try {
      const imported = await automationsApi.importFile(clusterId);
      if (imported) {
        toast.info(`Opened ${imported.name}`, { description: "Fill in the webhook URLs and headers, then save." });
        setEditing(imported);
      }
    } catch (e) {
      toast.error("Could not open the pipeline", { description: e instanceof Error ? e.message : String(e) });
    }
  }

  async function exportFile(automation: Automation) {
    try {
      const path = await automationsApi.exportFile(automation);
      if (path) toast.success(`Saved ${automation.name}`, { description: path });
    } catch (e) {
      toast.error("Could not save the pipeline", { description: e instanceof Error ? e.message : String(e) });
    }
  }

  return (
    <>
      <PageHeader
        title="Pipelines"
        description={automations.data ? `${visible.length} for this cluster` : undefined}
        actions={
          <>
            <Button size="sm" variant="outline" onClick={() => void importFile()}>
              <FileUpIcon /> Open file
            </Button>
            <Button size="sm" onClick={() => setEditing(emptyAutomation(clusterId))}>
              <PlusIcon /> New pipeline
            </Button>
          </>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col gap-4 p-4">
        {automations.error && <ErrorState error={automations.error} onRetry={() => automations.refetch()} />}
        <TableFrame>
          <Table aria-label="Pipelines">
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="w-44">Status</TableHead>
                <TableHead className="w-24 text-right">Sent</TableHead>
                <TableHead className="w-24 text-right">Failed</TableHead>
                <TableHead className="w-24 text-right">Skipped</TableHead>
                <TableHead className="w-20">On</TableHead>
                <TableHead className="w-24">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((a) => {
                const status = statusById.get(a.id);
                return (
                  <TableRow key={a.id}>
                    <TableCell>
                      <div className="font-medium">{a.name}</div>
                      <div className="font-mono text-xs text-muted-foreground">{a.topic}</div>
                      {a.enabled && status?.lastError && (
                        <div className="mt-1 text-xs break-words text-destructive">{status.lastError}</div>
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusBadge enabled={a.enabled} status={status} />
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{formatNumber(status?.fired ?? 0)}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{formatNumber(status?.failed ?? 0)}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{formatNumber(status?.dropped ?? 0)}</TableCell>
                    <TableCell>
                      <Switch
                        size="sm"
                        aria-label={`Run ${a.name}`}
                        checked={a.enabled}
                        disabled={setEnabled.isPending}
                        onCheckedChange={(enabled) => toggle(a, enabled)}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon-sm" aria-label={`Edit ${a.name}`} onClick={() => setEditing(a)}>
                          <PencilIcon />
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon-sm" aria-label={`More for ${a.name}`}>
                              <EllipsisIcon />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => setReplaying(a)}>
                              <HistoryIcon /> Replay messages…
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => void exportFile(a)}>
                              <FileDownIcon /> Save as file…
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => setPublishing(a)}>
                              <UploadCloudIcon /> Publish to Kafka Connect…
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(a)}>
                              <Trash2Icon /> Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {visible.length === 0 && (
                <TableStateRow colSpan={7}>
                  {emptyText(automations, "No pipelines yet. Create one to send new messages to a webhook.")}
                </TableStateRow>
              )}
            </TableBody>
          </Table>
        </TableFrame>
      </div>

      {editing && (
        <AutomationFormDialog
          // A new key resets the form when switching between automations.
          key={editing.id || "new"}
          open
          onOpenChange={(open) => !open && setEditing(null)}
          automation={editing}
        />
      )}
      <DeleteAutomationDialog automation={deleting} onClose={() => setDeleting(null)} />
      <ReplayDialog automation={replaying} onClose={() => setReplaying(null)} />
      <KafkaConnectDialog automation={publishing} onClose={() => setPublishing(null)} />
    </>
  );
}

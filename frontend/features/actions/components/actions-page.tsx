import {
  ArrowDown01Icon,
  ArrowRight02Icon,
  Delete02Icon,
  MoreHorizontalIcon,
  PencilEdit02Icon,
  PlusSignIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import { toast } from "sonner";

import { useClusterId } from "@/app/stores/navigation-store";
import { PageHeader } from "@/components/page-header";
import { ErrorState, LoadingText } from "@/components/query-states";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatNumber } from "@/lib/format";

import { DESTINATIONS, destinationOf, type AvailableDestination, type ExecutorKind } from "../destinations";
import { isActive } from "../draft";
import { useActions, useActionStatuses, useDeleteAction } from "../queries";
import type { Action, RunStatus } from "../types";
import { ActionDetailSheet } from "./action-detail-sheet";
import { ActionEditorSheet } from "./action-editor-sheet";
import { DestinationCatalog } from "./destination-catalog";
import { DestinationIcon } from "./destination-icon";
import { RunControls } from "./run-controls";
import { RunStateBadge } from "./status-badges";

type Editing = { action: Action } | { action: null; kind: ExecutorKind } | null;

export function ActionsPage() {
  const clusterId = useClusterId();
  const actions = useActions(clusterId);
  const statuses = useActionStatuses(clusterId);
  const [editing, setEditing] = useState<Editing>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Action | null>(null);
  const statusOf = (id: string) => statuses.data?.find((s) => s.actionId === id);
  const list = actions.data ?? [];
  const opened = list.find((a) => a.id === openId) ?? null;
  const running = (statuses.data ?? []).filter((s) => isActive(s.state)).length;
  const create = (destination: AvailableDestination) => setEditing({ action: null, kind: destination.kind });

  return (
    <>
      <PageHeader
        title="Actions"
        description={
          actions.data
            ? `${list.length} action${list.length === 1 ? "" : "s"}${running ? ` · ${running} running` : ""}`
            : undefined
        }
        actions={list.length > 0 && <NewActionMenu onSelect={create} />}
      />
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4">
        {actions.error && <ErrorState error={actions.error} onRetry={() => actions.refetch()} />}
        {actions.isPending && <LoadingText />}
        {actions.data && list.length === 0 && <GettingStarted onSelect={create} />}
        {list.length > 0 && (
          <div className="grid gap-3 lg:grid-cols-2">
            {list.map((action) => (
              <ActionCard
                key={action.id}
                clusterId={clusterId}
                action={action}
                status={statusOf(action.id)}
                onOpen={() => setOpenId(action.id)}
                onEdit={() => setEditing({ action })}
                onDelete={() => setDeleting(action)}
              />
            ))}
          </div>
        )}
      </div>

      <ActionEditorSheet
        clusterId={clusterId}
        open={editing != null}
        action={editing?.action ?? null}
        kind={editing?.action ? editing.action.executor.kind : (editing?.kind ?? "localLambda")}
        onClose={() => setEditing(null)}
      />
      <ActionDetailSheet
        clusterId={clusterId}
        action={opened}
        status={opened ? statusOf(opened.id) : undefined}
        onEdit={(action) => setEditing({ action })}
        onClose={() => setOpenId(null)}
      />
      <DeleteActionDialog clusterId={clusterId} action={deleting} onClose={() => setDeleting(null)} />
    </>
  );
}

interface ActionCardProps {
  clusterId: string;
  action: Action;
  status: RunStatus | undefined;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

function ActionCard({ clusterId, action, status, onOpen, onEdit, onDelete }: ActionCardProps) {
  const state = status?.state ?? { kind: "stopped" };
  const active = isActive(state);
  const destination = destinationOf(action.executor);
  return (
    <Card size="sm" className="relative gap-3 px-4 transition-colors hover:bg-muted/30">
      <div className="flex items-start gap-3">
        <DestinationIcon id={destination.id} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center gap-2">
            {/* The name is the card's one link, so the card has a single, clear target. */}
            <button
              type="button"
              onClick={onOpen}
              className="truncate text-left font-medium outline-none hover:underline focus-visible:underline after:absolute after:inset-0"
            >
              {action.name}
            </button>
            <RunStateBadge state={state} />
          </div>
          <p className="flex min-w-0 items-center gap-1.5 font-mono text-xs text-muted-foreground">
            <span className="truncate">{action.source.topic}</span>
            <HugeiconsIcon icon={ArrowRight02Icon} className="size-3 shrink-0" aria-label="invokes" />
            <span className="truncate">{action.executor.functionName}</span>
          </p>
        </div>
        {/* Above the card's stretched link, so these stay clickable. */}
        <div className="relative z-10 flex items-center gap-1">
          <RunControls clusterId={clusterId} action={action} state={state} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`More for ${action.name}`}>
                <HugeiconsIcon icon={MoreHorizontalIcon} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem disabled={active} onSelect={onEdit}>
                <HugeiconsIcon icon={PencilEdit02Icon} /> Edit
              </DropdownMenuItem>
              <DropdownMenuItem disabled={active} variant="destructive" onSelect={onDelete}>
                <HugeiconsIcon icon={Delete02Icon} /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="tabular-nums">{formatNumber(status?.processed ?? 0)} processed</span>
        {(status?.failed ?? 0) > 0 && (
          <span className="text-destructive tabular-nums">{formatNumber(status?.failed ?? 0)} failed</span>
        )}
        {active && <span className="tabular-nums">{status?.inFlight ?? 0} in flight</span>}
      </div>
      {state.kind === "failed" && (
        <p className="line-clamp-2 font-mono text-xs break-all text-destructive">{state.message}</p>
      )}
    </Card>
  );
}

function NewActionMenu({ onSelect }: { onSelect: (destination: AvailableDestination) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm">
          <HugeiconsIcon icon={PlusSignIcon} /> New action <HugeiconsIcon icon={ArrowDown01Icon} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Send to</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {DESTINATIONS.map((d) => (
          <DropdownMenuItem
            key={d.id}
            disabled={d.status === "planned"}
            onSelect={() => d.status === "available" && onSelect(d)}
          >
            <DestinationIcon id={d.id} size="sm" />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate">{d.title}</span>
              <span className="truncate text-xs text-muted-foreground">{d.runtime}</span>
            </span>
            {d.status === "planned" && <Badge variant="secondary">Soon</Badge>}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function GettingStarted({ onSelect }: { onSelect: (destination: AvailableDestination) => void }) {
  return (
    <div className="page-enter mx-auto flex w-full max-w-3xl flex-col gap-6 py-10">
      <div className="flex flex-col gap-1.5 text-center">
        <h2 className="text-lg font-semibold">Run your local code on every Kafka message</h2>
        <p className="text-sm text-muted-foreground">Pick where each new message on a topic should go.</p>
      </div>
      <DestinationCatalog onSelect={onSelect} />
    </div>
  );
}

function DeleteActionDialog({ clusterId, action, onClose }: { clusterId: string; action: Action | null; onClose: () => void }) {
  const remove = useDeleteAction(clusterId);
  return (
    <AlertDialog open={action != null} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {action?.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            The action and its history go away. Its consumer group <span className="font-mono">{action?.source.groupId}</span>{" "}
            stays on the cluster with its committed offsets.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => {
              if (!action) return;
              remove.mutate(action.id, {
                onSuccess: () => toast.success(`Deleted ${action.name}`),
                onError: (e) => toast.error("Couldn't delete", { description: e.message }),
              });
            }}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

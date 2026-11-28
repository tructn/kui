import { Bug01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";

import { destinationOf } from "../destinations";
import { isActive } from "../draft";
import { useActionStatuses, useSendToAction } from "../queries";
import type { Action } from "../types";
import { DestinationIcon } from "./destination-icon";

interface SendToActionButtonProps {
  clusterId: string;
  /** The Actions that read this message's topic. */
  actions: Action[];
  message: { partition: number; offset: number };
}

/** A message-table row's menu for sending that one message to an Action, to step through it in a debugger. */
export function SendToActionButton({ clusterId, actions, message }: SendToActionButtonProps) {
  const send = useSendToAction(clusterId);
  const statuses = useActionStatuses(clusterId);
  const { partition, offset } = message;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-emerald-600 hover:bg-emerald-500/15 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300"
          aria-busy={send.isPending}
          aria-label={`Debug partition ${partition}, offset ${offset} with an action`}
          title="Send this message to an action"
        >
          {send.isPending ? <Spinner /> : <HugeiconsIcon icon={Bug01Icon} />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Send this message to</DropdownMenuLabel>
        {actions.map((action) => {
          const state = statuses.data?.find((s) => s.actionId === action.id)?.state;
          // A running Action is busy with its own stream; this message would queue behind it.
          const busy = state != null && isActive(state);
          return (
            <DropdownMenuItem
              key={action.id}
              disabled={busy}
              onSelect={() => send.mutate({ action, partition, offset })}
            >
              <DestinationIcon id={destinationOf(action.executor).id} size="sm" />
              <span className="flex min-w-0 flex-col">
                <span className="truncate">{action.name}</span>
                <span className="truncate font-mono text-xs text-muted-foreground">
                  {busy ? "Running: stop it to send one message" : action.executor.functionName}
                </span>
              </span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

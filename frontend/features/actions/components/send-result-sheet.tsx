import { AlertCircleIcon, ArrowRight02Icon, Bug01Icon, StopIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutationState, type MutationState } from "@tanstack/react-query";
import { useRef, useState } from "react";

import { ResizableSheetContent } from "@/components/resizable-sheet-content";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Sheet, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";

import { MAX_TIMEOUT_SECS } from "../draft";
import { actionKeys, useSendToAction, useStopAction, type SendRequest } from "../queries";
import type { ExecutionDetail } from "../types";
import { ExecutionView } from "./execution-view";

type SendState = MutationState<ExecutionDetail, Error, SendRequest>;

/**
 * Follows the newest message sent with `SendToActionButton`: waiting (with a way to stop), then the result.
 * Mount it once next to the message table; it opens by itself when a send starts.
 */
export function SendResultSheet({ clusterId }: { clusterId: string }) {
  const contentRef = useRef<HTMLDivElement>(null);
  // Sends from before this page opened finished long ago; only follow new ones.
  const [since] = useState(() => Date.now());
  const [dismissed, setDismissed] = useState<number | null>(null);
  const sends = useMutationState({
    filters: { mutationKey: actionKeys.send },
    select: (mutation) => ({ id: mutation.mutationId, state: mutation.state as SendState }),
  });
  const latest = sends.filter((s) => s.state.submittedAt >= since).at(-1);
  const shown = latest != null && latest.id !== dismissed ? latest : null;

  return (
    <Sheet open={shown != null} onOpenChange={(open) => !open && shown && setDismissed(shown.id)}>
      <ResizableSheetContent
        ref={contentRef}
        panelId="action-send"
        defaultWidth={760}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          contentRef.current?.focus();
        }}
      >
        {shown?.state.variables && (
          <SendBody clusterId={clusterId} request={shown.state.variables} state={shown.state} />
        )}
      </ResizableSheetContent>
    </Sheet>
  );
}

function SendBody({ clusterId, request, state }: { clusterId: string; request: SendRequest; state: SendState }) {
  const { action, partition, offset } = request;
  const send = useSendToAction(clusterId);
  const stop = useStopAction(clusterId);
  const pending = state.status === "pending";

  return (
    <>
      <SheetHeader className="border-b">
        <SheetTitle className="flex items-center gap-2">
          <HugeiconsIcon icon={Bug01Icon} className="size-4" aria-hidden />
          {action.name}
        </SheetTitle>
        <SheetDescription className="flex items-center gap-1.5 font-mono">
          partition {partition} · offset {offset}
          <HugeiconsIcon icon={ArrowRight02Icon} className="size-3" aria-label="sent to" />
          {action.executor.functionName}
        </SheetDescription>
        <div className="flex flex-wrap gap-2 pt-2">
          {pending ? (
            <Button size="sm" variant="outline" disabled={stop.isPending} onClick={() => stop.mutate(action.id)}>
              <HugeiconsIcon icon={StopIcon} /> Stop waiting
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={() => send.mutate(request)}>
              <HugeiconsIcon icon={Bug01Icon} /> Send again
            </Button>
          )}
        </div>
      </SheetHeader>
      <div className="flex flex-col gap-4 overflow-y-auto p-4">
        {pending && (
          <div role="status" className="flex items-start gap-3 rounded-lg border p-4 text-sm">
            <Spinner className="mt-0.5" />
            <div className="flex flex-col gap-1">
              <span>Waiting for {action.executor.functionName} to answer…</span>
              <span className="text-muted-foreground">
                Only this message is sent and no offset is committed, so you can stay at a breakpoint for up to{" "}
                {MAX_TIMEOUT_SECS / 60} minutes.
              </span>
            </div>
          </div>
        )}
        {state.status === "error" && (
          <Alert variant="destructive">
            <HugeiconsIcon icon={AlertCircleIcon} />
            <AlertTitle>The message wasn't sent</AlertTitle>
            <AlertDescription className="break-all whitespace-pre-wrap">{state.error?.message}</AlertDescription>
          </Alert>
        )}
        {state.status === "success" && state.data && <ExecutionView detail={state.data} />}
      </div>
    </>
  );
}

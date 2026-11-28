import { ResizableSheetContent } from "@/components/resizable-sheet-content";
import { Sheet, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

import { destinationForKind, type ExecutorKind } from "../destinations";
import { ActionEditorForm } from "./action-editor-form";
import { DestinationIcon } from "./destination-icon";

interface NewActionSheetProps {
  clusterId: string;
  /** Where the new Action sends messages; null closes the sheet. */
  kind: ExecutorKind | null;
  onClose: () => void;
}

export function NewActionSheet({ clusterId, kind, onClose }: NewActionSheetProps) {
  const destination = kind ? destinationForKind(kind) : null;
  return (
    <Sheet open={kind != null} onOpenChange={(next) => !next && onClose()}>
      <ResizableSheetContent panelId="action-editor" defaultWidth={720}>
        {kind && (
          <ActionEditorForm
            clusterId={clusterId}
            action={null}
            kind={kind}
            autoFocus
            onCancel={onClose}
            onSaved={onClose}
            header={
              <SheetHeader className="flex-row items-center gap-3 border-b px-5 pr-12">
                {destination && <DestinationIcon id={destination.id} />}
                <div className="flex flex-col gap-1">
                  <SheetTitle>New action</SheetTitle>
                  {destination && (
                    <SheetDescription className="text-xs">
                      {destination.title} · {destination.runtime}
                    </SheetDescription>
                  )}
                </div>
              </SheetHeader>
            }
          />
        )}
      </ResizableSheetContent>
    </Sheet>
  );
}

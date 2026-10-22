import { CopyIndicator, useCopy } from "@/components/copy-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ResizableSheetContent } from "@/components/resizable-sheet-content";
import { Sheet, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatBytes, formatTimestamp } from "@/lib/format";

import type { CopyTarget, KafkaMessage, Payload } from "../types";
import { CopyMessageDialog } from "./copy-message-dialog";
import { encodingLabel, PayloadViewTabs, usePayloadView } from "./payload-view-tabs";

interface MessageSheetProps {
  clusterId: string;
  topic: string;
  /** Topics the message can be copied to. */
  targets: CopyTarget[];
  /** Hides copy for internal topics. */
  readOnly?: boolean;
  message: KafkaMessage | null;
  onClose: () => void;
}

/** Side panel showing one message's value, key and headers in full. */
export function MessageSheet({ clusterId, topic, targets, readOnly = false, message, onClose }: MessageSheetProps) {
  return (
    <Sheet open={message != null} onOpenChange={(open) => !open && onClose()}>
      <ResizableSheetContent panelId="message" defaultWidth={672}>
        {message && (
          <>
            <SheetHeader className="border-b">
              <SheetTitle className="font-mono">
                Partition {message.partition} · Offset {message.offset}
              </SheetTitle>
              <SheetDescription className="font-mono">{formatTimestamp(message.timestamp)}</SheetDescription>
              {!readOnly && (
                <div className="pt-2">
                  <CopyMessageDialog
                    // Fresh form state for each message.
                    key={`${message.partition}/${message.offset}`}
                    clusterId={clusterId}
                    topic={topic}
                    messages={[message]}
                    targets={targets}
                  />
                </div>
              )}
            </SheetHeader>
            <Tabs defaultValue="value" className="min-h-0 flex-1 p-4">
              <TabsList>
                <TabsTrigger value="value">Value</TabsTrigger>
                <TabsTrigger value="key">Key</TabsTrigger>
                <TabsTrigger value="headers">Headers ({message.headers.length})</TabsTrigger>
              </TabsList>
              <TabsContent value="value" className="min-h-0">
                <PayloadView payload={message.value} />
              </TabsContent>
              <TabsContent value="key" className="min-h-0">
                <PayloadView payload={message.key} />
              </TabsContent>
              <TabsContent value="headers" className="flex flex-col gap-2">
                {message.headers.length === 0 && <p className="text-sm text-muted-foreground">No headers.</p>}
                {message.headers.map((h, i) => (
                  <div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-3 font-mono text-xs">
                    <span className="truncate text-muted-foreground">{h.key}</span>
                    <span className="break-all">{h.value ?? "null"}</span>
                  </div>
                ))}
              </TabsContent>
            </Tabs>
          </>
        )}
      </ResizableSheetContent>
    </Sheet>
  );
}

function PayloadView({ payload }: { payload: Payload | null }) {
  // Kept while moving between messages; a binary payload shows base64.
  const { views, shown, setView, text } = usePayloadView(payload);
  const { copied, copy } = useCopy();
  if (!payload || text == null) return <p className="text-sm text-muted-foreground">null</p>;

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center gap-2">
        <PayloadViewTabs views={views} value={shown} onChange={setView} />
        <Badge variant="outline">{encodingLabel(payload)}</Badge>
        <Badge variant="outline">{formatBytes(payload.size)}</Badge>
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => copy(text)}
        >
          <CopyIndicator copied={copied} /> {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <pre className="min-h-0 flex-1 overflow-auto rounded-lg bg-muted p-3 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap">
        {text}
      </pre>
    </div>
  );
}

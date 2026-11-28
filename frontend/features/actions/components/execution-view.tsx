import { CopyButton } from "@/components/copy-button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { prettyJson } from "@/lib/format";

import { formatDuration } from "../draft";
import { decodedMskValue } from "../msk";
import type { Body, ExecutionDetail } from "../types";
import { ExecutionStatusBadge } from "./status-badges";

/** One finished invocation: status, error, and the response, request and decoded value in tabs. */
export function ExecutionView({ detail }: { detail: ExecutionDetail }) {
  const decoded = detail.request ? decodedMskValue(detail.request.text) : null;

  return (
    <section aria-label="Execution" className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <ExecutionStatusBadge status={detail.status} />
        <span className="font-mono">{detail.function}</span>
        <span className="text-muted-foreground">
          partition {detail.partition} · offset {detail.offset} · {formatDuration(detail.durationMs)}
        </span>
      </div>
      {detail.error && (
        <p className="rounded-md bg-destructive/10 p-2.5 font-mono text-xs break-all whitespace-pre-wrap text-destructive">
          {detail.error}
        </p>
      )}
      <Tabs defaultValue={detail.response ? "response" : "request"}>
        <TabsList>
          <TabsTrigger value="response">Response</TabsTrigger>
          <TabsTrigger value="request">Request</TabsTrigger>
          {decoded != null && <TabsTrigger value="value">Message value</TabsTrigger>}
        </TabsList>
        <TabsContent value="response">
          <BodyView body={detail.response} empty="No response." />
        </TabsContent>
        <TabsContent value="request">
          <BodyView body={detail.request} empty="Not sent: the payload couldn't be built." />
        </TabsContent>
        {decoded != null && (
          <TabsContent value="value">
            <BodyView body={{ text: decoded, truncated: false }} empty="" />
          </TabsContent>
        )}
      </Tabs>
    </section>
  );
}

/** Payloads come from Kafka and the function, so they render as text only. */
function BodyView({ body, empty }: { body: Body | null; empty: string }) {
  if (!body) return <p className="py-2 text-sm text-muted-foreground">{empty}</p>;
  const text = prettyJson(body.text);
  return (
    <div className="relative">
      <div className="absolute top-1.5 right-1.5">
        <CopyButton value={body.text} label="Copy" />
      </div>
      <pre className="max-h-96 overflow-auto rounded-md bg-muted/50 p-3 pr-10 font-mono text-code break-all whitespace-pre-wrap">
        {text}
      </pre>
      {body.truncated && <p className="pt-1 text-xs text-muted-foreground">Cut to the first 16 KiB.</p>}
    </div>
  );
}

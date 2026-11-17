import { DatabaseZapIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useMessageSample } from "@/features/messages";

import { hostOf } from "../pipeline";
import { useBodyPreview } from "../queries";
import type { Body, HttpMethod, WebhookHeader } from "../types";

/** The message a body is tried on. Its headers are the message's, not the webhook's. */
export interface Sample {
  value: string;
  key: string;
  headers: WebhookHeader[];
}

export const EMPTY_SAMPLE: Sample = { value: "", key: "", headers: [] };

interface DataInspectorProps {
  clusterId: string;
  topic: string;
  name: string;
  body: Body;
  method: HttpMethod;
  url: string;
  /** Names only: values are secrets. */
  headerNames: string[];
  sample: Sample;
  onSampleChange: (sample: Sample) => void;
}

/** What goes in and what comes out, beside every step. */
export function DataInspector({
  clusterId,
  topic,
  name,
  body,
  method,
  url,
  headerNames,
  sample,
  onSampleChange,
}: DataInspectorProps) {
  const hasSample = sample.value.trim() !== "";
  const request = useDebouncedValue(
    { name, body, sample: { topic, key: sample.key || null, value: sample.value || null, headers: sample.headers } },
    400,
  );
  // Without a sample there is nothing to show, and "{}" would only mislead.
  const preview = useBodyPreview(request.name, request.body, request.sample, hasSample);
  const latest = useMessageSample(clusterId, topic.trim(), false);

  async function useLatest() {
    const { data, error } = await latest.refetch();
    const message = data?.messages[0];
    if (error || !message) {
      toast.error(error ? "Could not read the topic" : "The topic has no messages yet", { description: error?.message });
      return;
    }
    if (message.value?.encoding !== "utf8") {
      toast.error("The newest message is not text, so it can't be used as a sample");
      return;
    }
    if (message.value.truncated) toast.warning("The newest message is large and was cut short, so its JSON may be incomplete");
    onSampleChange({
      value: message.value.text,
      key: message.key?.encoding === "utf8" ? message.key.text : "",
      headers: message.headers.flatMap((h) => (h.value === null ? [] : [{ name: h.key, value: h.value }])),
    });
  }

  const host = hostOf(url);

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <section aria-labelledby="inspector-in" className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h3 id="inspector-in" className="text-sm font-medium">
            Sample message <span className="font-normal text-muted-foreground">in</span>
          </h3>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={topic.trim() === "" || latest.isFetching}
            onClick={useLatest}
          >
            {latest.isFetching ? <Spinner /> : <DatabaseZapIcon />} Use newest from topic
          </Button>
        </div>
        <Field>
          <FieldLabel htmlFor="sample-value" className="sr-only">
            Sample message value
          </FieldLabel>
          <Textarea
            id="sample-value"
            className="min-h-32 font-mono text-xs"
            placeholder={'{"id": 7, "customer": {"name": "Ada"}}'}
            value={sample.value}
            onChange={(e) => onSampleChange({ ...sample, value: e.target.value })}
          />
        </Field>
        <Input
          aria-label="Sample message key"
          className="font-mono"
          placeholder="Key (optional)"
          value={sample.key}
          onChange={(e) => onSampleChange({ ...sample, key: e.target.value })}
        />
      </section>

      <section aria-labelledby="inspector-out" className="flex flex-col gap-2">
        <h3 id="inspector-out" className="text-sm font-medium">
          Request <span className="font-normal text-muted-foreground">out</span>
        </h3>
        <div className="rounded-md border bg-muted/30">
          <div className="flex flex-wrap items-baseline gap-x-2 border-b px-2.5 py-1.5 font-mono text-xs">
            <span className="font-semibold">{method}</span>
            <span className="text-muted-foreground">{host ?? "no webhook yet"}</span>
          </div>
          {headerNames.length > 0 && (
            <p className="border-b px-2.5 py-1.5 font-mono text-xs break-words text-muted-foreground">
              {headerNames.join(", ")}
            </p>
          )}
          {preview.isError && (
            <p role="alert" className="px-2.5 py-2 text-xs break-words text-destructive">
              {preview.error.message}
            </p>
          )}
          {preview.data !== undefined && !preview.isError ? (
            <pre aria-label="Body preview" className="max-h-96 overflow-auto p-2.5 font-mono text-xs">
              {preview.data}
            </pre>
          ) : (
            !preview.isError && (
              <p className="px-2.5 py-2 text-xs text-muted-foreground">
                Add a sample message to see the exact body. Nothing is sent from here.
              </p>
            )
          )}
        </div>
      </section>
    </div>
  );
}

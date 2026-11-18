import { Trash2Icon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { QueryField } from "@/features/messages";

import { listPaths, type SampleContext } from "../../sample-fields";
import type { Automation, FieldMapping, Route } from "../../types";
import { MappingEditor } from "../mapping-editor";

const PER_MESSAGE = "message";

interface TransformPanelProps {
  automation: Automation;
  route: Route;
  onChange: (patch: Partial<Route>) => void;
  /** Fields built earlier, kept while the body is switched back to the whole message. */
  fields: FieldMapping[];
  onFieldsChange: (fields: FieldMapping[]) => void;
  /** Null when this is the only route, which can't be removed. */
  onRemove: (() => void) | null;
  context: SampleContext;
  /** The body the preview built for the sample. */
  sent: unknown;
  /** The request this route would make for the sample. */
  preview: ReactNode;
}

/** Which messages one route takes, and what it sends: the whole message or fields picked from it. */
export function TransformPanel({
  automation,
  route,
  onChange,
  fields,
  onFieldsChange,
  onRemove,
  context,
  sent,
  preview,
}: TransformPanelProps) {
  const body = route.action.body;
  const customized = body.kind !== "envelope";
  const lists = [...new Set([...listPaths(context), ...(route.split ? [route.split] : [])])];
  const setBody = (next: Route["action"]["body"]) => onChange({ action: { ...route.action, body: next } });

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <label className="flex items-center gap-2 text-sm" title="Off sends the whole message as JSON">
          <Switch
            checked={customized}
            onCheckedChange={(on) => setBody(on ? { kind: "mapping", fields } : { kind: "envelope" })}
          />
          Pick the fields to send
        </label>
        {lists.length > 0 && (
          <div className="flex items-center gap-2 text-sm">
            <span>Send</span>
            <Select
              value={route.split ?? PER_MESSAGE}
              onValueChange={(v) => onChange({ split: v === PER_MESSAGE ? null : v })}
            >
              <SelectTrigger aria-label="Requests" size="sm" className="w-auto max-w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={PER_MESSAGE}>one request per message</SelectItem>
                {lists.map((path) => (
                  <SelectItem key={path} value={path}>
                    one request per item of <span className="font-mono">{path}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {onRemove && (
          <Button type="button" variant="ghost" size="sm" className="ml-auto text-destructive" onClick={onRemove}>
            <Trash2Icon /> Remove route
          </Button>
        )}
      </div>

      <Field>
        <FieldLabel>Only messages matching (optional)</FieldLabel>
        <QueryField
          clusterId={automation.clusterId}
          topic={automation.topic}
          value={route.query ?? ""}
          onChange={(query) => onChange({ query: query.trim() ? query : null })}
        />
      </Field>

      <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        {customized ? (
          <MappingEditor
            key={route.id}
            fields={body.kind === "mapping" ? body.fields : fields}
            onChange={(next) => {
              onFieldsChange(next);
              setBody({ kind: "mapping", fields: next });
            }}
            context={context}
            split={route.split}
            sent={sent}
          />
        ) : (
          <div className="flex max-w-md flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              The whole message is sent as JSON: topic, partition, offset, time, key, value and headers
              {route.split && (
                <>
                  , plus the current <span className="font-mono">item</span>
                </>
              )}
              . Switch on <span className="font-medium text-foreground">Pick the fields to send</span> to choose and
              reshape them.
            </p>
          </div>
        )}
        {preview}
      </div>
    </div>
  );
}

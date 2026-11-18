import { SendIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";

import { HTTP_METHODS, type Action, type HttpMethod, type Route } from "../../types";

interface WebhookPanelProps {
  route: Route;
  headersText: string;
  onHeadersTextChange: (text: string) => void;
  onActionChange: (patch: Partial<Action>) => void;
  onTest: () => void;
  testing: boolean;
  /** The request this route would make for the sample. */
  preview: ReactNode;
}

/** Where one route sends its message, beside the exact request. */
export function WebhookPanel({
  route,
  headersText,
  onHeadersTextChange,
  onActionChange,
  onTest,
  testing,
  preview,
}: WebhookPanelProps) {
  const { action } = route;

  return (
    <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
      <FieldGroup>
        <div className="grid grid-cols-[7rem_1fr] gap-3">
          <Field>
            <FieldLabel>Method</FieldLabel>
            <Select value={action.method} onValueChange={(m) => onActionChange({ method: m as HttpMethod })}>
              <SelectTrigger className="w-full" aria-label="Method">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {HTTP_METHODS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor={`url-${route.id}`}>URL</FieldLabel>
            <Input
              id={`url-${route.id}`}
              className="font-mono"
              placeholder="https://hooks.example.com/…"
              value={action.url}
              onChange={(e) => onActionChange({ url: e.target.value })}
            />
          </Field>
        </div>
        <Field>
          <FieldLabel htmlFor={`headers-${route.id}`}>Headers (optional)</FieldLabel>
          <Textarea
            id={`headers-${route.id}`}
            className="min-h-16 font-mono text-xs"
            placeholder={"Authorization: Bearer …\nX-Source: kui"}
            value={headersText}
            onChange={(e) => onHeadersTextChange(e.target.value)}
          />
          <FieldDescription>
            One per line as Name: value. The URL and header values are kept in the system keychain.
          </FieldDescription>
        </Field>
        <div>
          <Button type="button" variant="outline" disabled={testing || !action.url.trim()} onClick={onTest}>
            {testing ? <Spinner /> : <SendIcon />} Send test
          </Button>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Sends the sample message once to this webhook, ignoring the route's filter.
          </p>
        </div>
      </FieldGroup>
      {preview}
    </div>
  );
}

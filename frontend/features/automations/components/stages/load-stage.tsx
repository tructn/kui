import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

import { HTTP_METHODS, MAX_PER_MINUTE, type Automation, type HttpMethod } from "../../types";

interface LoadStageProps {
  automation: Automation;
  headersText: string;
  onHeadersTextChange: (text: string) => void;
  onChange: (patch: Partial<Automation>) => void;
  onActionChange: (patch: Partial<Automation["action"]>) => void;
}

/** Where the message goes, and how often. */
export function LoadStage({ automation, headersText, onHeadersTextChange, onChange, onActionChange }: LoadStageProps) {
  const { action } = automation;

  return (
    <FieldGroup>
      <FieldSet>
        <FieldLegend variant="label">Webhook</FieldLegend>
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
            <FieldLabel htmlFor="automation-url">URL</FieldLabel>
            <Input
              id="automation-url"
              autoFocus
              className="font-mono"
              placeholder="https://hooks.example.com/…"
              value={action.url}
              onChange={(e) => onActionChange({ url: e.target.value })}
            />
          </Field>
        </div>
        <FieldDescription>The URL and header values are kept in the system keychain.</FieldDescription>
        <Field>
          <FieldLabel htmlFor="automation-headers">Headers (optional)</FieldLabel>
          <Textarea
            id="automation-headers"
            className="min-h-16 font-mono text-xs"
            placeholder={"Authorization: Bearer …\nX-Source: kui"}
            value={headersText}
            onChange={(e) => onHeadersTextChange(e.target.value)}
          />
          <FieldDescription>
            One per line as Name: value. The body is sent as application/json unless you set Content-Type.
          </FieldDescription>
        </Field>
      </FieldSet>

      <FieldSet>
        <FieldLegend variant="label">Limit</FieldLegend>
        <Field>
          <FieldLabel htmlFor="automation-rate">Most calls a minute</FieldLabel>
          <Input
            id="automation-rate"
            type="number"
            min={1}
            max={MAX_PER_MINUTE}
            className="w-28 font-mono"
            value={Number.isNaN(automation.maxPerMinute) ? "" : automation.maxPerMinute}
            onChange={(e) => onChange({ maxPerMinute: e.target.value === "" ? Number.NaN : Number(e.target.value) })}
          />
          <FieldDescription>
            Matching messages beyond this are skipped, so a busy topic can't flood the webhook.
          </FieldDescription>
        </Field>
      </FieldSet>
    </FieldGroup>
  );
}

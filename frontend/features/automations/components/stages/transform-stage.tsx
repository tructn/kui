import { cn } from "@/lib/utils";

import type { SourceGroup } from "../../source-fields";
import type { Body, FieldMapping } from "../../types";
import { FieldMappingEditor } from "../field-mapping-editor";

/** What is edited for each way of making the body. Switching keeps what was built for the other. */
export interface BodyDraft {
  kind: "envelope" | "mapping";
  fields: FieldMapping[];
}

/** A body saved as free text (no longer offered here) opens as an empty mapping. */
export function draftOf(body: Body): BodyDraft {
  return body.kind === "mapping" ? { kind: "mapping", fields: body.fields } : { kind: "envelope", fields: [] };
}

const OPTIONS: { kind: BodyDraft["kind"]; title: string; hint: string }[] = [
  {
    kind: "envelope",
    title: "Send the whole message",
    hint: "Topic, partition, offset, time, key, value and headers, as JSON.",
  },
  {
    kind: "mapping",
    title: "Customize the message",
    hint: "Pick the fields to send and what to call them.",
  },
];

interface TransformStageProps {
  draft: BodyDraft;
  onChange: (draft: BodyDraft) => void;
  /** Fields of the sample message, to drag from. */
  groups: SourceGroup[];
}

/** Either the message as it is, or a new one built by dragging fields into place. */
export function TransformStage({ draft, onChange, groups }: TransformStageProps) {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div role="group" aria-label="What to send" className="grid gap-2 sm:grid-cols-2">
        {OPTIONS.map(({ kind, title, hint }) => (
          <button
            key={kind}
            type="button"
            aria-pressed={draft.kind === kind}
            onClick={() => onChange({ ...draft, kind })}
            className={cn(
              "rounded-lg border p-3 text-left transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50",
              draft.kind === kind && "border-primary bg-muted",
            )}
          >
            <span className="block text-sm font-medium">{title}</span>
            <span className="block text-xs text-muted-foreground">{hint}</span>
          </button>
        ))}
      </div>

      {draft.kind === "mapping" && (
        <FieldMappingEditor fields={draft.fields} onChange={(fields) => onChange({ ...draft, fields })} groups={groups} />
      )}
    </div>
  );
}

import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { TopicPicker } from "@/components/topic-picker";
import { QueryField } from "@/features/messages";
import { useTopics } from "@/features/topics";

import { MAX_PER_MINUTE, type Automation } from "../../types";

interface SourcePanelProps {
  automation: Automation;
  onChange: (patch: Partial<Automation>) => void;
}

/** Which messages every route receives. */
export function SourcePanel({ automation, onChange }: SourcePanelProps) {
  const topics = useTopics(automation.clusterId);

  return (
    <FieldGroup className="max-w-2xl">
        <Field>
          <FieldLabel htmlFor="automation-topic">Topic</FieldLabel>
          <TopicPicker
            id="automation-topic"
            value={automation.topic}
            options={topics.data ?? []}
            placeholder={topics.isPending ? "Loading topics…" : "Choose a topic"}
            onChange={(topic) => onChange({ topic })}
          />
          <FieldDescription>Runs for each new message, starting from the moment it is saved.</FieldDescription>
        </Field>
        <Field>
          <FieldLabel>Filter for every route (optional)</FieldLabel>
          <QueryField
            clusterId={automation.clusterId}
            topic={automation.topic}
            value={automation.query ?? ""}
            onChange={(query) => onChange({ query })}
            suggestOnFocus
          />
          <FieldDescription>
            Same filter language as the message browser; click in for suggestions. Blank lets every message through.
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="automation-rate">Most calls a minute, across routes</FieldLabel>
          <Input
            id="automation-rate"
            type="number"
            min={1}
            max={MAX_PER_MINUTE}
            className="w-28 font-mono"
            value={Number.isNaN(automation.maxPerMinute) ? "" : automation.maxPerMinute}
            onChange={(e) => onChange({ maxPerMinute: e.target.value === "" ? Number.NaN : Number(e.target.value) })}
          />
          <FieldDescription>Calls beyond this are skipped, so a busy topic can't flood a webhook.</FieldDescription>
        </Field>
    </FieldGroup>
  );
}

import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { TopicPicker } from "@/components/topic-picker";
import { QueryField } from "@/features/messages";
import { useTopics } from "@/features/topics";

import type { Automation } from "../../types";

interface ExtractStageProps {
  automation: Automation;
  onChange: (patch: Partial<Automation>) => void;
}

/** Which messages to react to: a topic, narrowed by an optional filter. */
export function ExtractStage({ automation, onChange }: ExtractStageProps) {
  const topics = useTopics(automation.clusterId);

  return (
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor="automation-topic">Source topic</FieldLabel>
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
        <FieldLabel>Filter (optional)</FieldLabel>
        <QueryField
          clusterId={automation.clusterId}
          topic={automation.topic}
          value={automation.query ?? ""}
          onChange={(query) => onChange({ query })}
          suggestOnFocus
        />
        <FieldDescription>
          Same filter language as the message browser. Click in to see what you can filter on; fields come from this
          topic's recent messages, and Ctrl+Space (⌘L on Mac) reopens the list. Blank lets every message through.
        </FieldDescription>
      </Field>
    </FieldGroup>
  );
}

import { CheckIcon, PencilIcon, RefreshCwIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";

import type { SampleMessage } from "../sample-fields";

interface SampleBarProps {
  topic: string;
  sample: SampleMessage;
  /** The user typed the sample instead of using the topic's newest message. */
  edited: boolean;
  loading: boolean;
  onEdit: (sample: SampleMessage) => void;
  onUseNewest: () => void;
}

/** Which message the fields and values come from, with a way to refresh or paste another. */
export function SampleBar({ topic, sample, edited, loading, onEdit, onUseNewest }: SampleBarProps) {
  const [editing, setEditing] = useState(false);
  const empty = sample.value.trim() === "";

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex min-w-0 items-center gap-1 text-xs">
        <span className="font-medium">Sample</span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          {loading ? "loading…" : edited ? "edited" : empty ? "none yet" : `newest on ${topic}`}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Use the newest message on the topic"
          title="Use the newest message on the topic"
          disabled={topic.trim() === "" || loading}
          onClick={onUseNewest}
        >
          {loading ? <Spinner /> : <RefreshCwIcon />}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={editing ? "Done editing the sample" : "Edit the sample"}
          aria-pressed={editing}
          onClick={() => setEditing((e) => !e)}
        >
          {editing ? <CheckIcon /> : <PencilIcon />}
        </Button>
      </div>
      {(editing || (empty && !loading)) && (
        <div className="flex flex-col gap-1.5">
          <Textarea
            id="sample-value"
            aria-label="Sample message value"
            className="min-h-28 font-mono text-xs"
            placeholder={'Paste a message, e.g. {"id": 7, "items": [{"sku": "a"}]}'}
            value={sample.value}
            onChange={(e) => onEdit({ ...sample, value: e.target.value })}
          />
          <Input
            aria-label="Sample message key"
            className="h-8 font-mono text-xs"
            placeholder="Key (optional)"
            value={sample.key}
            onChange={(e) => onEdit({ ...sample, key: e.target.value })}
          />
        </div>
      )}
    </div>
  );
}

import { FilterIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { cn } from "@/lib/utils";

import { useFieldCatalog } from "../query/use-field-catalog";
import { useMessageSample } from "../queries";
import type { QueryProblem } from "../types";
import { QueryEditor } from "./query-editor";

interface QueryFieldProps {
  clusterId: string;
  /** The topic whose recent messages feed the suggestions; blank gives only keywords and operators. */
  topic: string;
  value: string;
  onChange: (value: string) => void;
  /** Show the suggestions as soon as the empty field is focused, and load the topic's fields up front. */
  suggestOnFocus?: boolean;
}

/**
 * A one-line message filter for forms: the same highlighting, suggestions and error underlines as
 * the message browser's filter bar, without running anything. Suggestions come from recent messages
 * of the topic and appear only when something matches what is being typed.
 */
export function QueryField({ clusterId, topic, value, onChange, suggestOnFocus = false }: QueryFieldProps) {
  const [sampling, setSampling] = useState(false);
  const [problem, setProblem] = useState<QueryProblem | null>(null);
  const name = topic.trim();
  const sample = useMessageSample(clusterId, name, (sampling || suggestOnFocus) && name !== "");
  const sources = useMemo(() => [sample.data?.messages ?? []], [sample.data]);
  const getCatalog = useFieldCatalog(sources);
  const invalid = problem !== null && value.trim() !== "";

  return (
    <div className="flex flex-col gap-1">
      <div
        className={cn(
          "flex min-h-8 items-center rounded-lg border border-input pr-1 pl-2.5 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30",
          invalid && "border-destructive focus-within:border-destructive focus-within:ring-destructive/20",
        )}
      >
        <FilterIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <QueryEditor
          value={value}
          onChange={onChange}
          // Enter must not submit the surrounding form.
          onSubmit={() => {}}
          getCatalog={getCatalog}
          onProblem={setProblem}
          onFocus={() => setSampling(true)}
          suggestOnFocus={suggestOnFocus}
        />
      </div>
      {invalid && (
        <p role="alert" className="px-1 text-xs text-destructive">
          {problem.message}
        </p>
      )}
    </div>
  );
}

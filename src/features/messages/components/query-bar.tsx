import { CornerDownLeftIcon, FilterIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { InfoList, InfoTip } from "@/components/info-tip";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { messagesApi } from "../api";
import type { FieldCatalog } from "../query/catalog";
import type { QueryProblem } from "../types";
import { QueryEditor } from "./query-editor";

interface QueryBarProps {
  /** The filter in effect; null = none. */
  query: string | null;
  onApply: (query: string | null) => void;
  getCatalog: () => FieldCatalog;
  /** The editor was focused: time to sample messages for suggestions. */
  onFocus?: () => void;
  disabled?: boolean;
}

/** SQL-like message filter. Typing only edits; Enter (or Apply) runs it. */
export function QueryBar({ query, onApply, getCatalog, onFocus, disabled }: QueryBarProps) {
  const [draft, setDraft] = useState(query ?? "");
  const [problem, setProblem] = useState<QueryProblem | null>(null);
  useEffect(() => setDraft(query ?? ""), [query]);

  const applied = (query ?? "").trim();
  const pending = draft.trim() !== applied;

  async function apply() {
    const text = draft.trim();
    if (!text) return onApply(null);
    // The as-you-type check is delayed; make sure before running.
    const found = await messagesApi.checkQuery(text).catch(() => null);
    setProblem(found);
    if (!found) onApply(text);
  }

  return (
    <div className="flex flex-col gap-1">
      <div
        className={cn(
          "flex min-h-8 items-center rounded-lg border border-input pl-2.5 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30",
          problem && draft.trim() && "border-destructive focus-within:border-destructive focus-within:ring-destructive/20",
          applied && !pending && "border-primary/40",
        )}
      >
        <FilterIcon className={cn("size-3.5 shrink-0", applied ? "text-primary" : "text-muted-foreground")} />
        <QueryEditor
          value={draft}
          onChange={setDraft}
          onSubmit={apply}
          getCatalog={getCatalog}
          onProblem={setProblem}
          onFocus={onFocus}
          disabled={disabled}
        />
        <div className="flex shrink-0 items-center gap-1 pr-1">
          <InfoTip label="Filter syntax" className="mx-1">
            <QueryHelp />
          </InfoTip>
          {(draft || applied) && (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Clear filter"
              disabled={disabled}
              onClick={() => {
                setDraft("");
                setProblem(null);
                if (applied) onApply(null);
              }}
            >
              <XIcon />
            </Button>
          )}
          <Button
            variant={pending ? "default" : "ghost"}
            size="xs"
            disabled={disabled || !pending || (problem !== null && draft.trim() !== "")}
            onClick={apply}
          >
            Apply <CornerDownLeftIcon className="size-3" />
          </Button>
        </div>
      </div>
      {problem && draft.trim() && (
        <p role="alert" className="px-1 text-xs text-destructive">
          {problem.message}
        </p>
      )}
    </div>
  );
}

function QueryHelp() {
  return (
    <div className="flex max-w-sm flex-col gap-2 py-0.5">
      <p>
        A SQL <code>WHERE</code> condition, checked against every message. Missing fields never match, but they do
        pass <code>!=</code> and <code>NOT …</code>.
      </p>
      <InfoList
        items={[
          { term: <code>value.status = 'shipped'</code>, description: "JSON fields by path; key, value and headers.<name>" },
          { term: <code>value.items[*].qty &gt; 3</code>, description: "[*] or a name across an array: any element" },
          { term: <code>key LIKE 'order-%'</code>, description: "LIKE / ILIKE: % any text, _ one character" },
          { term: <code>value CONTAINS 'error'</code>, description: "Text in a field or the whole payload; or an array element" },
          { term: <code>headers.x-source IN ('web', 'ios')</code>, description: "Also NOT IN, BETWEEN … AND …, IS [NOT] NULL" },
          { term: <code>timestamp &gt;= '2026-10-01 08:00'</code>, description: "Dates in local time; also partition and offset" },
          { term: <code>lower(value.name) = 'ada'</code>, description: "Functions: lower, upper, trim, length, type" },
        ]}
      />
      <p className="opacity-80">Ctrl+Space shows suggestions, drawn from recent messages.</p>
    </div>
  );
}

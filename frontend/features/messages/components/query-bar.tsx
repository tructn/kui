import { CornerDownLeftIcon, FilterIcon, Maximize2Icon, Minimize2Icon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { InfoList, InfoTip } from "@/components/info-tip";
import { MOD_KEY, ShortcutHint } from "@/components/shortcut-hint";
import { Button } from "@/components/ui/button";
import { useViewState } from "@/hooks/use-view-state";
import { cn } from "@/lib/utils";

import { messagesApi } from "../api";
import type { FieldCatalog } from "../query/catalog";
import type { QueryProblem } from "../types";
import { flattenQuery, QueryEditor } from "./query-editor";

interface QueryBarProps {
  /** The filter in effect; null = none. */
  query: string | null;
  onApply: (query: string | null) => void;
  getCatalog: () => FieldCatalog;
  /** The editor was focused: time to sample messages for suggestions. */
  onFocus?: () => void;
  disabled?: boolean;
}

/**
 * SQL-like message filter. Typing only edits; Enter (or Apply) runs it.
 * Toggles between a one-line bar and a multi-line editor, where Enter adds a
 * line and Mod-Enter runs.
 */
export function QueryBar({ query, onApply, getCatalog, onFocus, disabled }: QueryBarProps) {
  const [expanded, setExpanded] = useViewState("messages.queryEditorExpanded", false);
  const shown = (q: string | null) => (expanded ? (q ?? "") : flattenQuery(q ?? ""));
  const [draft, setDraft] = useState(shown(query));
  const [problem, setProblem] = useState<QueryProblem | null>(null);
  useEffect(() => setDraft(shown(query)), [query]);

  const applied = (query ?? "").trim();
  // Joining lines (collapsing the editor) doesn't change the filter.
  const pending = flattenQuery(draft.trim()) !== flattenQuery(applied);
  const invalid = problem !== null && draft.trim() !== "";

  /** `current` is the editor's text on Enter; `draft` can lag a moment behind typing. */
  async function apply(current: string = draft) {
    const text = current.trim();
    if (!text) return onApply(null);
    // The as-you-type check is delayed; make sure before running.
    const found = await messagesApi.checkQuery(text).catch(() => null);
    setProblem(found);
    if (!found) onApply(text);
  }

  const editor = (
    <QueryEditor
      value={draft}
      onChange={setDraft}
      onSubmit={apply}
      getCatalog={getCatalog}
      onProblem={setProblem}
      onFocus={onFocus}
      multiline={expanded}
      disabled={disabled}
      className={expanded ? "h-full" : undefined}
    />
  );

  const actions = (
    <div className="flex shrink-0 items-center gap-1">
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
        variant="ghost"
        size="icon-xs"
        aria-label={expanded ? "Collapse filter editor" : "Expand filter editor"}
        aria-pressed={expanded}
        title={expanded ? "Collapse to one line" : "Open the multi-line editor"}
        onClick={() => setExpanded((e) => !e)}
      >
        {expanded ? <Minimize2Icon /> : <Maximize2Icon />}
      </Button>
      <Button variant={pending ? "default" : "ghost"} size="xs" disabled={disabled || !pending || invalid} onClick={() => apply()}>
        Apply {expanded ? <span className="opacity-70">{MOD_KEY}</span> : null}
        <CornerDownLeftIcon className="size-3" />
      </Button>
    </div>
  );

  const frame = cn(
    "rounded-lg border border-input transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30",
    invalid && "border-destructive focus-within:border-destructive focus-within:ring-destructive/20",
    applied && !pending && !invalid && "border-primary/40",
  );
  const filterIcon = <FilterIcon className={cn("size-3.5 shrink-0", applied ? "text-primary" : "text-muted-foreground")} />;

  if (!expanded) {
    return (
      <div className="flex flex-col gap-1">
        <div className={cn(frame, "flex min-h-8 items-center pl-2.5 pr-1")}>
          {filterIcon}
          {editor}
          {actions}
        </div>
        {invalid && (
          <p role="alert" className="px-1 text-xs text-destructive">
            {problem.message}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className={cn(frame, "flex flex-col overflow-hidden")}>
      <div className="flex h-9 items-center gap-2 border-b bg-muted/40 pl-2.5 pr-1">
        {filterIcon}
        <span className="text-xs font-medium">Filter</span>
        <span className="rounded border px-1 font-mono text-[10.5px] text-muted-foreground">WHERE</span>
        {applied && !pending && <span className="text-xs text-primary">Applied</span>}
        {pending && draft.trim() && <span className="text-xs text-muted-foreground">Edited, not applied</span>}
        <div className="flex-1" />
        {actions}
      </div>
      {/* Drag the bottom edge to resize; the editor fills the box. */}
      <div className="h-36 max-h-[60vh] min-h-20 resize-y overflow-hidden">{editor}</div>
      <div className="flex min-h-7 items-center gap-3 border-t bg-muted/40 px-2.5 py-1 text-xs text-muted-foreground">
        {invalid ? (
          <p role="alert" className="min-w-0 flex-1 truncate text-destructive" title={problem.message}>
            {problem.message}
          </p>
        ) : (
          <span className="flex-1">{draft.trim() ? "Valid" : "Empty filter shows every message"}</span>
        )}
        <span className="hidden items-center gap-1 sm:flex">
          <ShortcutHint keys={[MOD_KEY, "↵"]} /> run
        </span>
        <span className="hidden items-center gap-1 sm:flex">
          <ShortcutHint keys={MOD_KEY === "⌘" ? ["⌘", "L"] : ["Ctrl", "Space"]} /> suggest
        </span>
      </div>
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
      <p className="opacity-80">
        Suggestions appear as you type; Ctrl+Space (or ⌘L on macOS) opens them, and Tab or Enter picks one. They're drawn from recent messages. In the expanded editor, Enter adds a line and {MOD_KEY}+Enter runs.
      </p>
    </div>
  );
}

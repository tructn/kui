import { RefreshIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { JsonTree, JsonTreeBoundary } from "@/components/json-tree";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { parseJson } from "@/lib/json-tree";
import { cn } from "@/lib/utils";

import type { GeneratedRecord } from "../types";

interface RecordPreviewProps {
  records: GeneratedRecord[] | undefined;
  error: Error | null;
  loading: boolean;
  /** True while showing the previous template's output. */
  stale: boolean;
  onShuffle: () => void;
}

/** A few sample records, as a JSON tree, so the template can be checked before producing anything. */
export function RecordPreview({ records, error, loading, stale, onShuffle }: RecordPreviewProps) {
  return (
    <section aria-label="Preview" className="flex min-h-0 min-w-0 flex-col gap-2">
      <div className="flex h-8 items-center gap-2">
        <span className="text-sm font-medium">Preview</span>
        {loading && <Spinner className="size-3" />}
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          className="ml-auto"
          aria-label="New samples"
          title="New samples"
          onClick={onShuffle}
        >
          <HugeiconsIcon icon={RefreshIcon} />
        </Button>
      </div>
      {error && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 font-mono text-code break-all text-destructive">
          {error.message}
        </p>
      )}
      {records && (
        <JsonTreeBoundary fallback={null}>
          <JsonTree
            text={toSampleArray(records)}
            openDepth={3}
            className={cn("max-h-[28rem] min-h-80 flex-1", (error || stale) && "opacity-50")}
          />
        </JsonTreeBoundary>
      )}
    </section>
  );
}

/**
 * The records as one JSON array. A value that is JSON is nested as such; one that isn't (a
 * template that isn't JSON) stays a string, so a broken template still previews.
 */
function toSampleArray(records: GeneratedRecord[]): string {
  return JSON.stringify(
    records.map((r) => ({
      key: r.key,
      ...(r.headers.length > 0 && { headers: Object.fromEntries(r.headers.map((h) => [h.key, h.value])) }),
      value: parseJson(r.value) ?? r.value,
    })),
  );
}

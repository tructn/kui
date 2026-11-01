import { Spinner } from "@/components/ui/spinner";
import { prettyJson } from "@/lib/format";
import { cn } from "@/lib/utils";

import type { GeneratedRecord } from "../types";

interface RecordPreviewProps {
  records: GeneratedRecord[] | undefined;
  error: Error | null;
  loading: boolean;
  /** True while showing the previous template's output. */
  stale: boolean;
}

/** A few sample records so the template can be checked before producing anything. */
export function RecordPreview({ records, error, loading, stale }: RecordPreviewProps) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center gap-2 text-sm font-medium">
        Preview {loading && <Spinner className="size-3" />}
      </div>
      {error && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 font-mono text-xs text-destructive">
          {error.message}
        </p>
      )}
      <div className={cn("flex max-h-80 flex-col gap-2 overflow-y-auto", (error || stale) && "opacity-50")}>
        {records?.map((record, i) => (
          <div key={i} className="rounded-lg bg-muted p-3 font-mono text-code">
            <div className="mb-1 truncate text-muted-foreground">
              key: {record.key ?? <span className="italic">null</span>}
              {record.headers.map((h) => ` · ${h.key}=${h.value}`).join("")}
            </div>
            <pre className="break-all whitespace-pre-wrap">{prettyJson(record.value)}</pre>
          </div>
        ))}
      </div>
    </div>
  );
}

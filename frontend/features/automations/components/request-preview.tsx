import { hostOf } from "../pipeline";
import type { BodyPreview, HttpMethod } from "../types";

interface RequestPreviewProps {
  /** The body built for the sample; no data without a sample. */
  preview: { data?: BodyPreview; error: Error | null };
  split: string | null;
  method: HttpMethod;
  url: string;
  /** Names only: values are secrets. */
  headerNames: string[];
}

/** The request a sample message would make, beside every step. Nothing is sent from here. */
export function RequestPreview({ preview, split, method, url, headerNames }: RequestPreviewProps) {
  const host = hostOf(url);

  return (
    <section aria-labelledby="inspector-out" className="flex min-w-0 flex-col gap-2">
      <h3 id="inspector-out" className="text-sm font-medium">
        Request <span className="font-normal text-muted-foreground">out</span>
        {preview.data && preview.data.requests > 1 && !preview.error && (
          <span className="font-normal text-muted-foreground"> · first of {preview.data.requests}</span>
        )}
      </h3>
      <div className="rounded-md border bg-muted/30">
        <div className="flex flex-wrap items-baseline gap-x-2 border-b px-2.5 py-1.5 font-mono text-xs">
          <span className="font-semibold">{method}</span>
          <span className="text-muted-foreground">{host ?? "no webhook yet"}</span>
        </div>
        {headerNames.length > 0 && (
          <p className="border-b px-2.5 py-1.5 font-mono text-xs break-words text-muted-foreground">
            {headerNames.join(", ")}
          </p>
        )}
        {preview.error ? (
          <p role="alert" className="px-2.5 py-2 text-xs break-words text-destructive">
            {preview.error.message}
          </p>
        ) : preview.data?.first != null ? (
          <pre aria-label="Body preview" className="max-h-96 overflow-auto p-2.5 font-mono text-xs">
            {preview.data.first}
          </pre>
        ) : (
          <p className="px-2.5 py-2 text-xs text-muted-foreground">
            {preview.data ? (
              <>
                The sample has no items in <span className="font-mono">{split}</span>, so nothing would be sent.
              </>
            ) : (
              "With a sample message (under Transform), the exact body shows here. Nothing is sent from here."
            )}
          </p>
        )}
      </div>
    </section>
  );
}

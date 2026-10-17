import { CircleAlertIcon, RotateCwIcon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

/** Placeholder rows shown while a table loads. */
export function LoadingRows({ rows = 6 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
    </div>
  );
}

interface ErrorStateProps {
  error: Error;
  onRetry?: () => void;
}

/** Inline error with an optional retry button. */
export function ErrorState({ error, onRetry }: ErrorStateProps) {
  return (
    <Alert variant="destructive">
      <CircleAlertIcon />
      <AlertTitle>Request failed</AlertTitle>
      <AlertDescription>
        <p className="font-mono text-xs break-all">{error.message}</p>
        {onRetry && (
          <Button variant="outline" size="sm" className="mt-2" onClick={onRetry}>
            <RotateCwIcon /> Retry
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}

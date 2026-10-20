import { CircleAlertIcon, RotateCwIcon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/**
 * What an empty table says. Screens render their table before the data arrives,
 * so "empty" can also mean still loading or failed (the error shows above it).
 */
export function emptyText(query: { isPending: boolean; isError: boolean }, empty: string) {
  if (query.isError) return "Could not be loaded.";
  if (query.isPending) return "Loading…";
  return empty;
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

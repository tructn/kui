import { ChevronRightIcon } from "lucide-react";

import { useGenerators } from "../queries";

/** Cheat sheet of every `{{placeholder}}`; clicking one inserts it into the value template. */
export function PlaceholderList({ onInsert }: { onInsert: (snippet: string) => void }) {
  const generators = useGenerators();
  return (
    <details className="group rounded-lg border">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 text-sm font-medium select-none">
        <ChevronRightIcon className="size-4 transition-transform group-open:rotate-90" />
        Placeholders
        <span className="ml-auto text-xs font-normal text-muted-foreground">click to insert</span>
      </summary>
      <div className="flex max-h-64 flex-col overflow-y-auto border-t p-1">
        {generators.data?.map((g) => {
          const snippet = g.example.split(" / ")[0];
          return (
            <button
              key={g.name}
              type="button"
              title={g.example}
              onClick={() => onInsert(snippet)}
              className="flex flex-col items-start rounded-md px-2 py-1.5 text-left hover:bg-accent"
            >
              <code className="text-xs">{snippet}</code>
              <span className="text-xs text-muted-foreground">{g.description}</span>
            </button>
          );
        })}
      </div>
    </details>
  );
}

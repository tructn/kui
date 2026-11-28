import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import { DESTINATIONS, type AvailableDestination, type Destination } from "../destinations";
import { DestinationIcon } from "./destination-icon";

/** Every destination type. Planned ones show but can't be chosen. */
export function DestinationCatalog({ onSelect }: { onSelect: (destination: AvailableDestination) => void }) {
  return (
    <ul className="grid gap-2 sm:grid-cols-3">
      {DESTINATIONS.map((destination) => (
        <li key={destination.id} className="flex">
          <DestinationTile destination={destination} onSelect={onSelect} />
        </li>
      ))}
    </ul>
  );
}

function DestinationTile({
  destination,
  onSelect,
}: {
  destination: Destination;
  onSelect: (destination: AvailableDestination) => void;
}) {
  const content = (
    <>
      <DestinationIcon id={destination.id} className={destination.status === "planned" ? "opacity-60" : undefined} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate font-medium">{destination.title}</span>
        <span className="truncate text-xs text-muted-foreground">{destination.runtime}</span>
      </span>
    </>
  );
  const tile = "flex w-full items-center gap-3 rounded-lg border bg-card p-3 text-left text-sm";

  if (destination.status === "planned") {
    return (
      <div className={cn(tile, "border-dashed bg-muted/20 text-muted-foreground")}>
        {content}
        <Badge variant="secondary">Soon</Badge>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onSelect(destination)}
      className={cn(
        tile,
        "outline-none transition-colors hover:border-primary/40 hover:bg-muted/30 focus-visible:ring-3 focus-visible:ring-ring/50",
      )}
    >
      {content}
    </button>
  );
}

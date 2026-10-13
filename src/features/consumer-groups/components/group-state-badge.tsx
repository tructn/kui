import { Badge } from "@/components/ui/badge";

/** Colors the group state: Stable = healthy, rebalancing = in progress, Empty/Dead = idle. */
export function GroupStateBadge({ state }: { state: string }) {
  if (state === "Stable") {
    return <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">{state}</Badge>;
  }
  if (state.includes("Rebalance")) {
    return <Badge className="bg-amber-500/15 text-amber-600 dark:text-amber-400">{state}</Badge>;
  }
  return <Badge variant="secondary">{state || "Unknown"}</Badge>;
}

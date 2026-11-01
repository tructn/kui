import type { ReactNode } from "react";

import { InfoTip } from "@/components/info-tip";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface StatCardProps {
  label: string;
  value: ReactNode;
  /** Explanation shown in a hoverable info icon next to the label. */
  info?: ReactNode;
  /** Highlights the value as a problem (e.g. offline partitions > 0). */
  warning?: boolean;
}

export function StatCard({ label, value, info, warning }: StatCardProps) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription className="flex items-center gap-1.5">
          {label}
          {info && <InfoTip label={`About ${label.toLowerCase()}`}>{info}</InfoTip>}
        </CardDescription>
        <CardTitle className={cn("font-mono text-2xl tabular-nums", warning && "text-destructive")}>
          {value}
        </CardTitle>
      </CardHeader>
    </Card>
  );
}

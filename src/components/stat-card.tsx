import type { ReactNode } from "react";

import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface StatCardProps {
  label: string;
  value: ReactNode;
  /** Highlights the value as a problem (e.g. offline partitions > 0). */
  warning?: boolean;
}

export function StatCard({ label, value, warning }: StatCardProps) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className={cn("font-mono text-2xl tabular-nums", warning && "text-destructive")}>
          {value}
        </CardTitle>
      </CardHeader>
    </Card>
  );
}

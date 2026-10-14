import type { ReactNode } from "react";

import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";

interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  /** Buttons shown on the right. */
  actions?: ReactNode;
}

/** Top bar shared by every page: sidebar toggle, title, actions. */
export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
      <SidebarTrigger className="-ml-1" />
      {/* No fixed height: the separator's self-stretch spans the bar edge to edge. */}
      <Separator orientation="vertical" />
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-sm font-medium">{title}</h1>
        {description && <p className="truncate text-xs text-muted-foreground">{description}</p>}
      </div>
      <div className="flex items-center gap-2">{actions}</div>
    </header>
  );
}

import { Fragment, type ReactNode } from "react";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { SidebarTrigger } from "@/components/ui/sidebar";

export interface Crumb {
  label: string;
  onSelect: () => void;
}

interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  /** Parent pages, outermost first; shown as links before the title. */
  crumbs?: Crumb[];
  /** Buttons for this page, pushed to the right edge. */
  actions?: ReactNode;
}

/** Top bar shared by every page. */
export function PageHeader({ title, description, crumbs, actions }: PageHeaderProps) {
  const heading = <h1 className="truncate text-sm font-medium text-foreground">{title}</h1>;

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
      {/* Below md the sidebar is an off-screen sheet, so its own collapse button can't open it. */}
      <SidebarTrigger className="-ml-1 md:hidden" />
      <div className="min-w-0">
        {crumbs?.length ? (
          <Breadcrumb>
            <BreadcrumbList className="flex-nowrap">
              {crumbs.map((crumb) => (
                <Fragment key={crumb.label}>
                  <BreadcrumbItem>
                    <BreadcrumbLink asChild>
                      <button
                        type="button"
                        className="cursor-pointer hover:underline"
                        onClick={crumb.onSelect}
                      >
                        {crumb.label}
                      </button>
                    </BreadcrumbLink>
                  </BreadcrumbItem>
                  <BreadcrumbSeparator />
                </Fragment>
              ))}
              <BreadcrumbItem aria-current="page" className="min-w-0">
                {heading}
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        ) : (
          heading
        )}
        {description && <p className="truncate text-xs text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

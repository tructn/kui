import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { useClusters, WelcomeScreen } from "@/features/clusters";
import { TopicSearch } from "@/features/topics";

import { AppSidebar } from "./app-sidebar";
import { useNavigation } from "./stores/navigation-store";
import { Router } from "./router";
import { SettingsDialog } from "./settings-dialog";

/** Sidebar + main area. Shows the welcome screen until a cluster is selected. */
export function AppShell() {
  const clusterId = useNavigation((s) => s.clusterId);
  const { data: clusters = [] } = useClusters();
  const hasActiveCluster = clusterId != null && clusters.some((c) => c.id === clusterId);

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="h-svh overflow-hidden">
        {hasActiveCluster ? <Router /> : <WelcomeScreen />}
      </SidebarInset>
      <SettingsDialog />
      {hasActiveCluster && <TopicSearch key={clusterId} />}
    </SidebarProvider>
  );
}

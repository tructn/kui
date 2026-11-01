import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { useClusters, WelcomeScreen } from "@/features/clusters";
import { TopicSearch } from "@/features/topics";

import { AppSidebar } from "./app-sidebar";
import { useNavigation } from "./stores/navigation-store";
import { Router } from "./router";
import { SettingsDialog } from "./settings-dialog";
import { UpdateDialog, useAutomaticUpdateCheck } from "./update-dialog";

/** Sidebar + main area. Shows the welcome screen until a cluster is selected. */
export function AppShell() {
  const clusterId = useNavigation((s) => s.clusterId);
  const { data: clusters = [], isPending } = useClusters();
  const hasActiveCluster = clusterId != null && clusters.some((c) => c.id === clusterId);
  // A remembered cluster opens straight on its page: don't flash the welcome screen while the list loads.
  const restoring = clusterId != null && isPending;
  useAutomaticUpdateCheck();

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="h-svh overflow-hidden">
        {hasActiveCluster ? <Router /> : restoring ? null : <WelcomeScreen />}
      </SidebarInset>
      <SettingsDialog />
      <UpdateDialog />
      {hasActiveCluster && <TopicSearch key={clusterId} />}
    </SidebarProvider>
  );
}

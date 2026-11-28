import { Database01Icon, PlusSignIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";

import { useNavigation } from "@/app/stores/navigation-store";
import { usePrivacy } from "@/app/stores/privacy-store";
import { ThemeMenuButton } from "@/app/theme-picker";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { maskClusterName } from "@/lib/mask";

import { useClusters } from "../queries";
import { ClusterFormDialog } from "./cluster-form-dialog";

/** Shown when no cluster is selected. */
export function WelcomeScreen() {
  const selectCluster = useNavigation((s) => s.selectCluster);
  const { data: clusters = [] } = useClusters();
  const maskNames = usePrivacy((s) => s.maskClusterNames);
  const [adding, setAdding] = useState(false);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center p-3">
        {/* Below md the sidebar is an off-screen sheet, so its own collapse button can't open it. */}
        <SidebarTrigger className="md:hidden" />
        <div className="ml-auto">
          <ThemeMenuButton />
        </div>
      </div>
      <Empty className="page-enter">
        <EmptyHeader>
          <EmptyMedia variant="icon" className="float-gentle">
            <HugeiconsIcon icon={Database01Icon} />
          </EmptyMedia>
          <EmptyTitle>{clusters.length ? "Select a cluster" : "Connect to Kafka"}</EmptyTitle>
          <EmptyDescription>
            {clusters.length
              ? "Pick a saved cluster to browse its topics, messages and consumer groups."
              : "Add your first cluster to start browsing topics, messages and consumer groups."}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <div className="flex flex-wrap justify-center gap-2">
            {clusters.map((c, i) => (
              <Button key={c.id} variant="outline" onClick={() => selectCluster(c.id)}>
                <HugeiconsIcon icon={Database01Icon} /> {maskClusterName(c.name, i, maskNames)}
              </Button>
            ))}
            <Button onClick={() => setAdding(true)}>
              <HugeiconsIcon icon={PlusSignIcon} /> Add cluster
            </Button>
          </div>
        </EmptyContent>
      </Empty>
      <ClusterFormDialog open={adding} onOpenChange={setAdding} onSaved={(c) => selectCluster(c.id)} />
    </div>
  );
}

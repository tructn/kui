import { DatabaseIcon, PlusIcon } from "lucide-react";
import { useState } from "react";

import { useNavigation } from "@/app/stores/navigation-store";
import { usePrivacy } from "@/app/stores/privacy-store";
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
      <div className="p-3">
        <SidebarTrigger />
      </div>
      <Empty className="page-enter">
        <EmptyHeader>
          <EmptyMedia variant="icon" className="float-gentle">
            <DatabaseIcon />
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
                <DatabaseIcon /> {maskClusterName(c.name, i, maskNames)}
              </Button>
            ))}
            <Button onClick={() => setAdding(true)}>
              <PlusIcon /> Add cluster
            </Button>
          </div>
        </EmptyContent>
      </Empty>
      <ClusterFormDialog open={adding} onOpenChange={setAdding} onSaved={(c) => selectCluster(c.id)} />
    </div>
  );
}

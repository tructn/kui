import { DatabaseIcon, PlusIcon } from "lucide-react";
import { useState } from "react";

import { useNavigation } from "@/app/stores/navigation-store";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { SidebarTrigger } from "@/components/ui/sidebar";

import { useClusters } from "../queries";
import { ClusterFormDialog } from "./cluster-form-dialog";

/** Shown when no cluster is selected. */
export function WelcomeScreen() {
  const selectCluster = useNavigation((s) => s.selectCluster);
  const { data: clusters = [] } = useClusters();
  const [adding, setAdding] = useState(false);

  return (
    <div className="flex h-full flex-col">
      <div className="p-3">
        <SidebarTrigger />
      </div>
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
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
            {clusters.map((c) => (
              <Button key={c.id} variant="outline" onClick={() => selectCluster(c.id)}>
                <DatabaseIcon /> {c.name}
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

import { ListTreeIcon } from "lucide-react";
import { create } from "zustand";

import { useClusterId, useNavigation } from "@/app/stores/navigation-store";
import { MOD_KEY } from "@/components/shortcut-hint";
import { Badge } from "@/components/ui/badge";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useShortcut } from "@/hooks/use-shortcut";
import { formatNumber } from "@/lib/format";

import { useTopics } from "../queries";

/** Lets the sidebar button and ⌘K open the same dialog. */
export const useTopicSearch = create<{ open: boolean; setOpen: (open: boolean) => void }>()((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));

/** ⌘K / Ctrl+K: jump to any topic of the current cluster by typing part of its name. */
export function TopicSearch() {
  const clusterId = useClusterId();
  const { open, setOpen } = useTopicSearch();
  const navigate = useNavigation((s) => s.navigate);
  // Only fetched while open; the topics page shares the same cached list.
  const topics = useTopics(clusterId, open);
  useShortcut("mod+k", () => setOpen(!useTopicSearch.getState().open));

  function openTopic(topic: string) {
    setOpen(false);
    navigate({ page: "topic", topic });
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Search topics"
      description={`Type part of a topic name, then press Enter to open it. ${MOD_KEY}K toggles this.`}
    >
      {/* CommandDialog doesn't provide cmdk's context itself; without <Command> the input throws. */}
      <Command>
        <CommandInput placeholder="Search topics…" aria-label="Search topics" />
        <CommandList>
          <CommandEmpty>{topics.isPending ? "Loading topics…" : "No matching topics."}</CommandEmpty>
          <CommandGroup heading="Topics">
            {topics.data?.map((t) => (
              <CommandItem key={t.name} value={t.name} onSelect={openTopic}>
                <ListTreeIcon />
                <span className="truncate font-mono">{t.name}</span>
                {t.internal && <Badge variant="outline">internal</Badge>}
                <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                  {formatNumber(t.messageCount)} msgs
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}

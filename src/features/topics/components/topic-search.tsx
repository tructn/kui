import { ListTreeIcon } from "lucide-react";
import { useMemo, useState } from "react";
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
  CommandShortcut,
} from "@/components/ui/command";
import { useShortcut } from "@/hooks/use-shortcut";
import { formatNumber } from "@/lib/format";
import { matchByName } from "@/lib/name-search";

import { useTopics } from "../queries";

/** Lets the sidebar button and ⌘K open the same dialog. */
export const useTopicSearch = create<{ open: boolean; setOpen: (open: boolean) => void }>()((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));

/** cmdk renders and scores every item, which freezes the dialog on clusters with tens of thousands of topics. */
const MAX_SHOWN = 100;

/** ⌘K / Ctrl+K: jump to any topic of the current cluster by typing part of its name. */
export function TopicSearch() {
  const { open, setOpen } = useTopicSearch();
  const navigate = useNavigation((s) => s.navigate);
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
      <TopicResults onSelect={openTopic} />
    </CommandDialog>
  );
}

/** Mounted only while the dialog is open, so the query starts empty each time. */
function TopicResults({ onSelect }: { onSelect: (topic: string) => void }) {
  // Only fetched while open; the topics page shares the same cached list.
  const topics = useTopics(useClusterId());
  const [query, setQuery] = useState("");
  const matches = useMemo(() => matchByName(topics.data ?? [], query), [topics.data, query]);
  const shown = matches.slice(0, MAX_SHOWN);

  return (
    // CommandDialog doesn't provide cmdk's context itself; without <Command> the input throws.
    // Filtering is done above, so cmdk only handles keyboard focus.
    <Command shouldFilter={false}>
      <CommandInput placeholder="Search topics…" aria-label="Search topics" value={query} onValueChange={setQuery} />
      <CommandList>
        <CommandEmpty>{topics.isPending ? "Loading topics…" : "No matching topics."}</CommandEmpty>
        {shown.length > 0 && (
          <CommandGroup heading="Topics">
            {shown.map((t) => (
              <CommandItem key={t.name} value={t.name} onSelect={onSelect}>
                <ListTreeIcon />
                <span className="min-w-0 truncate font-mono">{t.name}</span>
                {t.internal && <Badge variant="outline">internal</Badge>}
                {/* A shortcut slot hides CommandItem's trailing check icon, which would otherwise split the ml-auto space. */}
                <CommandShortcut className="shrink-0 pl-2 tracking-normal whitespace-nowrap tabular-nums">
                  {formatNumber(t.messageCount)} msgs
                </CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {matches.length > shown.length && (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">
            {formatNumber(matches.length - shown.length)} more. Type more of the name to narrow the list.
          </p>
        )}
      </CommandList>
    </Command>
  );
}

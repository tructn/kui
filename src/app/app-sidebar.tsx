import {
  ListTreeIcon,
  SearchIcon,
  ServerIcon,
  SettingsIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { MOD_KEY, ShortcutHint } from "@/components/shortcut-hint";
import { ClusterSwitcher } from "@/features/clusters";
import { useTopicSearch } from "@/features/topics";
import { useShortcut } from "@/hooks/use-shortcut";

import { useNavigation, type Route } from "./stores/navigation-store";
import { useSettingsDialog } from "./stores/settings-dialog-store";
import { ThemePicker } from "./theme-picker";

interface NavItem {
  label: string;
  icon: LucideIcon;
  page: Route["page"];
  route: Route;
  /** Opens the page with ⌘/Ctrl + this key. */
  key: string;
}

const NAV_ITEMS: NavItem[] = [
  { label: "Topics", icon: ListTreeIcon, page: "topics", route: { page: "topics" }, key: "1" },
  {
    label: "Consumer groups",
    icon: UsersIcon,
    page: "consumer-groups",
    route: { page: "consumer-groups" },
    key: "2",
  },
  { label: "Brokers", icon: ServerIcon, page: "brokers", route: { page: "brokers" }, key: "3" },
];

export function AppSidebar() {
  const route = useNavigation((s) => s.route);
  const navigate = useNavigation((s) => s.navigate);
  const clusterId = useNavigation((s) => s.clusterId);
  // The topic detail page belongs to the "Topics" section.
  const activePage = route.page === "topic" ? "topics" : route.page;
  useShortcut("mod+1", () => navigate(NAV_ITEMS[0].route), clusterId !== null);
  useShortcut("mod+2", () => navigate(NAV_ITEMS[1].route), clusterId !== null);
  useShortcut("mod+3", () => navigate(NAV_ITEMS[2].route), clusterId !== null);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <ClusterSwitcher />
      </SidebarHeader>
      <SidebarContent>
        {clusterId && (
          <>
            <SearchButton />
            <NavGroup label="Cluster" items={NAV_ITEMS} activePage={activePage} onNavigate={navigate} />
          </>
        )}
      </SidebarContent>
      <SidebarFooter>
        <FooterMenu />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

interface NavGroupProps {
  label: string;
  items: NavItem[];
  activePage: Route["page"];
  onNavigate: (route: Route) => void;
}

function NavGroup({ label, items, activePage, onNavigate }: NavGroupProps) {
  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.page}>
              <SidebarMenuButton
                tooltip={`${item.label} (${MOD_KEY}${item.key})`}
                aria-keyshortcuts={`Meta+${item.key} Control+${item.key}`}
                isActive={activePage === item.page}
                aria-current={activePage === item.page ? "page" : undefined}
                onClick={() => onNavigate(item.route)}
              >
                <item.icon />
                <span>{item.label}</span>
                <ShortcutHint keys={[MOD_KEY, item.key]} className={HINT} />
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

/** Shortcut labels sit at the right of a menu item and hide when the sidebar collapses to icons. */
const HINT = "ml-auto group-data-[collapsible=icon]:hidden";

function SearchButton() {
  const openSearch = useTopicSearch((s) => s.setOpen);
  return (
    <SidebarGroup className="pb-0">
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            tooltip={`Search topics (${MOD_KEY}K)`}
            aria-keyshortcuts="Meta+K Control+K"
            onClick={() => openSearch(true)}
            className="text-muted-foreground"
          >
            <SearchIcon />
            <span>Search topics</span>
            <ShortcutHint keys={[MOD_KEY, "K"]} className={HINT} />
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroup>
  );
}

function FooterMenu() {
  const showSettings = useSettingsDialog((s) => s.show);
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          tooltip={`Settings (${MOD_KEY},)`}
          aria-keyshortcuts="Meta+, Control+,"
          onClick={() => showSettings()}
        >
          <SettingsIcon />
          <span>Settings</span>
          <ShortcutHint keys={[MOD_KEY, ","]} className={HINT} />
        </SidebarMenuButton>
      </SidebarMenuItem>
      <SidebarMenuItem>
        {/* Stacks vertically when the sidebar collapses to icons. */}
        <ThemePicker iconOnly className="flex w-full group-data-[collapsible=icon]:flex-col" />
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

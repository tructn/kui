import {
  DatabaseLightningIcon,
  InsertColumnRightIcon,
  Radar01Icon,
  SearchAreaIcon,
  SlidersHorizontalIcon,
  ZapIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";

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
  useSidebar,
} from "@/components/ui/sidebar";
import { MOD_KEY, ShortcutHint } from "@/components/shortcut-hint";
import { useRunningActionCount } from "@/features/actions";
import { ClusterSwitcher } from "@/features/clusters";
import { useTopicSearch } from "@/features/topics";
import { useShortcut } from "@/hooks/use-shortcut";

import { useNavigation, type Route } from "./stores/navigation-store";
import { useSettingsDialog } from "./stores/settings-dialog-store";
import { ThemeMenuButton, ThemePicker } from "./theme-picker";

interface NavItem {
  label: string;
  icon: IconSvgElement;
  page: Route["page"];
  route: Route;
  /** Opens the page with ⌘/Ctrl + this key. */
  key: string;
}

// Ordered the way a cluster is built up: the brokers, the topics they host,
// then the consumer groups reading those topics.
const CLUSTER_ITEMS: NavItem[] = [
  { label: "Brokers", icon: DatabaseLightningIcon, page: "brokers", route: { page: "brokers" }, key: "1" },
  { label: "Topics", icon: InsertColumnRightIcon, page: "topics", route: { page: "topics" }, key: "2" },
  {
    label: "Consumer groups",
    icon: Radar01Icon,
    page: "consumer-groups",
    route: { page: "consumer-groups" },
    key: "3",
  },
];

// KUI's own work on the cluster's messages rather than views of Kafka state.
const AUTOMATION_ITEMS: NavItem[] = [
  { label: "Actions", icon: ZapIcon, page: "actions", route: { page: "actions" }, key: "4" },
];

const NAV_ITEMS = [...CLUSTER_ITEMS, ...AUTOMATION_ITEMS];

export function AppSidebar() {
  const route = useNavigation((s) => s.route);
  const navigate = useNavigation((s) => s.navigate);
  const clusterId = useNavigation((s) => s.clusterId);
  const { state, isMobile } = useSidebar();
  // The mobile sidebar is a full-width sheet, never the icon strip.
  const collapsed = state === "collapsed" && !isMobile;
  // The topic detail page belongs to the "Topics" section.
  const activePage = route.page === "topic" ? "topics" : route.page;
  useShortcut("mod+1", () => navigate(NAV_ITEMS[0].route), clusterId !== null);
  useShortcut("mod+2", () => navigate(NAV_ITEMS[1].route), clusterId !== null);
  useShortcut("mod+3", () => navigate(NAV_ITEMS[2].route), clusterId !== null);
  useShortcut("mod+4", () => navigate(NAV_ITEMS[3].route), clusterId !== null);
  const runningActions = useRunningActionCount(clusterId);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <ClusterSwitcher />
      </SidebarHeader>
      <SidebarContent>
        {clusterId && (
          <>
            <SearchButton />
            <NavGroup label="Cluster" items={CLUSTER_ITEMS} activePage={activePage} onNavigate={navigate} />
            <NavGroup
              label="Automation"
              items={AUTOMATION_ITEMS}
              activePage={activePage}
              onNavigate={navigate}
              // Actions keep running on other pages, so the sidebar says so.
              indicators={runningActions ? { actions: `${runningActions} running` } : {}}
            />
          </>
        )}
        <SettingsGroup />
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            {/* Collapsed to icons, three segments would be too small to hit: show one button with a menu. */}
            {collapsed ? <ThemeMenuButton /> : <ThemePicker iconOnly className="flex w-full" />}
          </SidebarMenuItem>
        </SidebarMenu>
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
  /** A dot on a page's item, with what it means for screen readers. */
  indicators?: Partial<Record<Route["page"], string>>;
}

function NavGroup({ label, items, activePage, onNavigate, indicators = {} }: NavGroupProps) {
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
                <HugeiconsIcon icon={item.icon} />
                <span>{item.label}</span>
                {indicators[item.page] && (
                  <span className="relative flex size-2" role="status" aria-label={indicators[item.page]}>
                    <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500/60" />
                    <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
                  </span>
                )}
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
            <HugeiconsIcon icon={SearchAreaIcon} />
            <span>Search topics</span>
            <ShortcutHint keys={[MOD_KEY, "K"]} className={HINT} />
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroup>
  );
}

/** App-wide settings, in their own group just below the cluster pages. */
function SettingsGroup() {
  const showSettings = useSettingsDialog((s) => s.show);
  return (
    <SidebarGroup>
      <SidebarGroupLabel>General</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip={`Settings (${MOD_KEY},)`}
              aria-keyshortcuts="Meta+, Control+,"
              onClick={() => showSettings()}
            >
              <HugeiconsIcon icon={SlidersHorizontalIcon} />
              <span>Settings</span>
              <ShortcutHint keys={[MOD_KEY, ","]} className={HINT} />
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

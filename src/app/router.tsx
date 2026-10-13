import { BrokersPage } from "@/features/brokers";
import { ConsumerGroupsPage } from "@/features/consumer-groups";
import { TopicPage, TopicsPage } from "@/features/topics";

import { useNavigation } from "./stores/navigation-store";

/** Renders the page for the current route. */
export function Router() {
  const route = useNavigation((s) => s.route);
  const clusterId = useNavigation((s) => s.clusterId);

  // `key` resets page state (filters, dialogs) when switching clusters.
  switch (route.page) {
    case "brokers":
      return <BrokersPage key={clusterId} />;
    case "topics":
      return <TopicsPage key={clusterId} />;
    case "topic":
      return <TopicPage key={`${clusterId}/${route.topic}`} topic={route.topic} />;
    case "consumer-groups":
      return <ConsumerGroupsPage key={clusterId} />;
  }
}

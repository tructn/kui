// auditor is a read-only monitoring account: it sees every topic and group but can change nothing.
// ACLs it relies on: Describe + DescribeConfigs on all topics (`*`), Describe on all groups (`*`), Describe +
// DescribeConfigs on the cluster.
import { kafkaAs } from "../kafka.ts";

const admin = kafkaAs("auditor").admin();
await admin.connect();
try {
  for (const topic of (await admin.listTopics()).sort()) {
    const offsets = await admin.fetchTopicOffsets(topic);
    // Transaction markers take offsets too, so on demo.payments this counts more than the payments.
    const span = offsets.reduce((sum, p) => sum + Number(p.high) - Number(p.low), 0);
    console.log(`topic  ${topic.padEnd(24)} ${String(offsets.length).padStart(2)} partitions  ${span} offsets`);
  }
  const { groups } = await admin.describeGroups((await admin.listGroups()).groups.map((g) => g.groupId));
  for (const group of groups) {
    console.log(`group  ${group.groupId.padEnd(24)} ${group.state}, ${group.members.length} members`);
  }
} finally {
  await admin.disconnect();
}

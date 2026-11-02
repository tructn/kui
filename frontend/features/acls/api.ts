// Mirrors `crates/kui_desktop/src/features/acls/commands.rs`.
import { callCommand } from "@/lib/invoke";

import type { Acl } from "./types";

export const aclsApi = {
  list: (clusterId: string) => callCommand<Acl[]>("list_acls", { clusterId }),
  create: (clusterId: string, acl: Acl) => callCommand<void>("create_acl", { clusterId, acl }),
  remove: (clusterId: string, acl: Acl) => callCommand<void>("delete_acl", { clusterId, acl }),
};

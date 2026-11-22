// Mirrors `crates/kui_desktop/src/features/acls/commands.rs`.
import { callCommand } from "@/lib/invoke";

import type { AclBinding } from "./types";

export const aclsApi = {
  list: (clusterId: string) => callCommand<AclBinding[]>("list_acls", { clusterId }),
  create: (clusterId: string, acls: AclBinding[]) => callCommand<void>("create_acls", { clusterId, acls }),
  /** Deletes exactly these ACLs; resolves to how many were removed. */
  remove: (clusterId: string, acls: AclBinding[]) => callCommand<number>("delete_acls", { clusterId, acls }),
};

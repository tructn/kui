import { create } from "zustand";
import { persist } from "zustand/middleware";

import { settingsStorage } from "@/lib/settings-storage";

interface Privacy {
  maskBootstrapServers: boolean;
  maskClusterNames: boolean;
}

interface PrivacyState extends Privacy {
  update: (patch: Partial<Privacy>) => void;
}

/** Settings → General: hide cluster details so they stay out of screenshots and screen shares. */
export const usePrivacy = create<PrivacyState>()(
  persist(
    (set) => ({
      maskBootstrapServers: false,
      maskClusterNames: false,
      update: (patch) => set(patch),
    }),
    { name: "kui.privacy", storage: settingsStorage() },
  ),
);

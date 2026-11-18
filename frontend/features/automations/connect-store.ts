import { create } from "zustand";
import { persist } from "zustand/middleware";

import { settingsStorage } from "@/lib/settings-storage";

import type { ConnectForm } from "./connect-form";

interface ConnectFormsState {
  /** The last Kafka Connect settings used, per KUI cluster. Never holds the password. */
  byCluster: Record<string, ConnectForm>;
  remember: (clusterId: string, form: ConnectForm) => void;
}

export const useConnectForms = create<ConnectFormsState>()(
  persist(
    (set) => ({
      byCluster: {},
      remember: (clusterId, form) => set((s) => ({ byCluster: { ...s.byCluster, [clusterId]: form } })),
    }),
    { name: "kui.kafkaConnect", storage: settingsStorage() },
  ),
);

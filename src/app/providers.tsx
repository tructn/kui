import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";


const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Kafka calls are relatively slow; don't retry or refetch on focus behind the user's back.
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: 10_000,
    },
  },
});

/**
 * App-wide React context. Client state (navigation, theme) lives in Zustand
 * stores under `app/stores/` and needs no provider.
 */
export function Providers({ children }: { children: ReactNode }) {
  return (
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          {children}
          <Toaster richColors position="bottom-right" />
        </TooltipProvider>
      </QueryClientProvider>
  );
}

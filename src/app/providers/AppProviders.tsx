import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { RuntimeProvider } from "../../core/runtime/RuntimeProvider";
import { queryClient } from "../../core/query/queryClient";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <RuntimeProvider>{children}</RuntimeProvider>
    </QueryClientProvider>
  );
}

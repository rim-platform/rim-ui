import { createContext, useContext, useMemo, type ReactNode } from "react";

import {
  detectPlatform,
  getRuntimeCapabilities,
  type AppPlatform,
  type RuntimeCapabilities,
} from "./runtime";

type RuntimeServices = {
  platform: AppPlatform;
  capabilities: RuntimeCapabilities;
};

const RuntimeContext = createContext<RuntimeServices | null>(null);

export function RuntimeProvider({ children }: { children: ReactNode }) {
  const value = useMemo<RuntimeServices>(() => {
    const platform = detectPlatform();
    return { platform, capabilities: getRuntimeCapabilities(platform) };
  }, []);

  return <RuntimeContext value={value}>{children}</RuntimeContext>;
}

export function useRuntime(): RuntimeServices {
  const ctx = useContext(RuntimeContext);
  if (!ctx) throw new Error("useRuntime must be used within RuntimeProvider");
  return ctx;
}

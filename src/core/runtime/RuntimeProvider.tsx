import { createContext, useContext, useMemo, type ReactNode } from "react";

import {
  detectPlatform,
  detectOs,
  getRuntimeCapabilities,
  type AppPlatform,
  type OsType,
  type RuntimeCapabilities,
} from "./runtime";

type RuntimeServices = {
  platform: AppPlatform;
  capabilities: RuntimeCapabilities;
  osType: OsType;
};

const RuntimeContext = createContext<RuntimeServices | null>(null);

export function RuntimeProvider({ children }: { children: ReactNode }) {
  const value = useMemo<RuntimeServices>(() => {
    const platform = detectPlatform();
    return {
      platform,
      capabilities: getRuntimeCapabilities(platform),
      osType: detectOs(),
    };
  }, []);

  return <RuntimeContext value={value}>{children}</RuntimeContext>;
}

export function useRuntime(): RuntimeServices {
  const ctx = useContext(RuntimeContext);
  if (!ctx) throw new Error("useRuntime must be used within RuntimeProvider");
  return ctx;
}
